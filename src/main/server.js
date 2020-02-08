var path = require('path')
var os = require('os')
var { ipcMain } = require('electron')
var createMapeoRouter = require('mapeo-server')
var ecstatic = require('ecstatic')
var createOsmRouter = require('osm-p2p-server')
var http = require('http')
var logger = require('electron-timber')
var throttle = require('lodash/throttle')

var userConfig = require('./user-config')

module.exports = function (osm, media, sendIpc, opts) {
  if (!opts) opts = {}
  var osmRouter = createOsmRouter(osm)
  var mapeoRouter = createMapeoRouter(osm, media, {
    staticRoot: opts.staticRoot,
    writeFormat: 'osm-p2p-syncfile',
    deviceType: 'desktop'
  })

  const mapeoCore = mapeoRouter.api.core

  // hostname often includes a TLD, which we remove
  const computerName = (os.hostname() || 'Mapeo Desktop').split('.')[0]
  mapeoCore.sync.setName(computerName)

  var server = http.createServer(function (req, res) {
    logger.log(req.method + ': ' + req.url)

    var staticHandler = ecstatic({
      root: path.join(__dirname, '..', '..', 'static'),
      baseDir: 'static'
    })

    var m = osmRouter.handle(req, res) || mapeoRouter.handle(req, res)
    if (m) {
      // TODO: make into regex for more robust checking
      if (req.url.indexOf('upload') > 0) sendIpc('territory-edit')
      if (req.url.indexOf('observation') > 0 && req.method === 'PUT') sendIpc('observation-edit')
    }

    if (!m) {
      staticHandler(req, res, function (err) {
        if (err) logger.error(err)
        res.statusCode = 404
        res.end('Not Found')
      })
    }
  })

  server.mapeo = mapeoCore

  const origListen = server.listen
  const origClose = server.close

  // Sending data over IPC is costly, and progress events fire frequently, so we
  // throttle updates to once every 50ms
  const throttledSendPeerUpdate = throttle(sendPeerUpdate, 50)

  server.listen = function listen (...args) {
    mapeoCore.sync.listen(() => {
      mapeoCore.sync.on('peer', onNewPeer)
      mapeoCore.sync.on('down', throttledSendPeerUpdate)
      ipcMain.on('sync-start', startSync)
      ipcMain.on('sync-join', joinSync)
      ipcMain.on('sync-leave', leaveSync)
      ipcMain.on('export-data', exportData)
      origListen.apply(server, args)
    })
  }

  function onNewPeer (peer) {
    throttledSendPeerUpdate(peer)
    if (!peer.sync) {
      return logger.error('Could not monitor peer, missing sync property')
    }
    peer.sync.once('sync-start', () => {
      watchSync(peer.sync)
    })
  }

  // Send message to frontend whenever there is an update to the peer list
  function sendPeerUpdate (peer) {
    const peers = mapeoCore.sync.peers().map(peer => {
      const { connection, ...rest } = peer
      return rest
    })
    sendIpc('peer-update', peers)
  }

  function watchSync (sync) {
    const startTime = Date.now()
    sync.on('error', onerror)
    sync.on('progress', throttledSendPeerUpdate)
    sync.on('end', onend)

    function onerror (err) {
      logger.error(err)
      sync.removeListener('error', onerror)
      sync.removeListener('progress', throttledSendPeerUpdate)
      sync.removeListener('end', onend)
    }

    function onend (err) {
      if (err) logger.error(err)
      sendIpc('sync-complete')
      const syncDurationSecs = ((Date.now() - startTime) / 1000).toFixed(2)
      logger.log('Sync completed in ' + syncDurationSecs + ' seconds')
      sync.removeListener('error', onerror)
      sync.removeListener('progress', throttledSendPeerUpdate)
      sync.removeListener('end', onend)
      sendPeerUpdate()
    }
  }

  function startSync (event, target = {}) {
    logger.log('Sync start request:', target)
    // if (!target.host || !target.port || !target.filename) return

    const sync = mapeoCore.sync.replicate(target, {
      deviceType: 'mobile',
      projectKey: opts.projectKey
    })
    sendPeerUpdate()
    watchSync(sync)
  }

  function joinSync () {
    try {
      logger.log(
        'Joining swarm',
        opts.projectKey && opts.projectKey.slice(0, 4)
      )
      mapeoCore.sync.join(opts.projectKey)
    } catch (e) {
      logger.error('sync join error', e)
    }
  }

  function leaveSync () {
    try {
      logger.log(
        'Leaving swarm',
        opts.projectKey && opts.projectKey.slice(0, 4)
      )
      mapeoCore.sync.leave(opts.projectKey)
    } catch (e) {
      logger.error('sync leave error', e)
    }
  }

  function exportData (event, { filename, format, id }) {
    const presets = userConfig.getSettings('presets') || {}
    mapeoCore.exportData(filename, { format, presets }, err => {
      sendIpc('export-data-' + id, err)
    })
  }

  server.close = function close (cb) {
    mapeoCore.sync.removeListener('peer', onNewPeer)
    mapeoCore.sync.removeListener('down', throttledSendPeerUpdate)
    ipcMain.removeListener('start-sync', startSync)
    ipcMain.removeListener('export-data', exportData)
    ipcMain.removeListener('sync-leave', leaveSync)
    ipcMain.removeListener('export-data', exportData)
    onReplicationComplete(() => {
      mapeoCore.sync.destroy(() => origClose.call(server, cb))
    })
  }

  function onReplicationComplete (cb) {
    // Wait for up to 5 minutes for replication to complete
    const timeoutId = setTimeout(() => {
      mapeoCore.sync.removeListener('down', checkIfDone)
      cb()
    }, 5 * 60 * 1000)

    checkIfDone()

    function checkIfDone () {
      const currentlyReplicatingPeers = mapeoCore.sync
        .peers()
        .filter(
          peer =>
            peer.state &&
            (peer.state.topic === 'replication-started' ||
              peer.state.topic === 'replication-progress')
        )
      logger.log(currentlyReplicatingPeers.length + ' peers still replicating')
      if (currentlyReplicatingPeers.length === 0) {
        clearTimeout(timeoutId)
        return cb()
      }
      mapeoCore.sync.once('down', checkIfDone)
    }
  }

  return server
}
