import React, { useState } from 'react'
import { makeStyles } from '@material-ui/core/styles'
import Button from '@material-ui/core/Button'
import Dialog from '@material-ui/core/Dialog'
import DialogActions from '@material-ui/core/DialogActions'
import DialogContent from '@material-ui/core/DialogContent'
import DialogTitle from '@material-ui/core/DialogTitle'
import { TextField, DialogContentText } from '@material-ui/core'
import { defineMessages, useIntl, FormattedMessage } from 'react-intl'
import logger from 'electron-timber'
import fsWriteStreamAtomic from 'fs-write-stream-atomic'
import path from 'path'
import { remote } from 'electron'
import pump from 'pump'

import ViewWrapper from 'react-mapfilter/commonjs/ViewWrapper'

import createZip from '../../create-zip'

const msgs = defineMessages({
  // Title for webmaps export dialog
  title: 'Export a map to share online',
  // Save button
  save: 'Save',
  // cancel button
  cancel: 'Cancel',
  // Label for field to enter map title
  titleLabel: 'Map Title',
  // Label for field to enter map description
  descriptionLabel: 'Map Description',
  // Label for field to enter terms and conditions
  termsLabel: 'Terms & Limitations',
  // Helper text explaining terms and conditions field
  termsHint: 'Add terms & limitations about how this data can be used',
  // Label for field to enter custom map style
  styleLabel: 'Map Style'
})

// const defaultMapStyle = 'mapbox://styles/mapbox/outdoors-v11'

const EditDialogContent = ({
  observations,
  getPreset,
  getMediaUrl,
  onClose
}) => {
  const classes = useStyles()
  const { formatMessage } = useIntl()
  const [saving, setSaving] = useState()
  const [title, setTitle] = useState()
  const [description, setDescription] = useState()
  // const [terms, setTerms] = useState()
  // const [mapStyle, setMapStyle] = useState(defaultMapStyle)

  const handleClose = () => {
    setSaving(false)
    setTitle(undefined)
    setDescription(undefined)
    // setTerms(undefined)
    // setMapStyle(defaultMapStyle)
    onClose()
  }

  const handleSave = e => {
    e.preventDefault()
    setSaving(true)
    const points = observationsToGeoJson(observations, getPreset)
    const metadata = { title: title || '', description: description || '' }

    remote.dialog.showSaveDialog(
      {
        title: 'Guardar Mapa',
        defaultPath: 'mapa-para-web',
        filters: [{ name: 'Mapeo Webmap Package', extensions: ['mapeomap'] }]
      },
      filepath => {
        const filepathWithExtension = path.join(
          path.dirname(filepath),
          path.basename(filepath, '.mapeomap') + '.mapeomap'
        )
        createArchive(filepathWithExtension, err => {
          if (err) {
            logger.error('Failed to create archive', err)
          } else {
            logger.log('Successfully created map archive')
          }
          handleClose()
        })
      }
    )

    function createArchive (filepath, cb) {
      const output = fsWriteStreamAtomic(filepath)

      const localFiles = [
        {
          data: JSON.stringify(points, null, 2),
          metadataPath: 'points.json'
        },
        {
          data: JSON.stringify(metadata, null, 2),
          metadataPath: 'metadata.json'
        }
      ]

      const remoteFiles = points.features
        .filter(point => point.properties.image)
        .map(point => ({
          url: getMediaUrl(point.properties.image, 'original'),
          metadataPath: 'images/' + point.properties.image
        }))

      const archive = createZip(localFiles, remoteFiles)

      pump(archive, output, cb)
    }
  }

  return (
    <form noValidate autoComplete='off'>
      <DialogTitle id='responsive-dialog-title' style={{ paddingBottom: 8 }}>
        <FormattedMessage {...msgs.title} />
      </DialogTitle>

      <DialogContent className={classes.content}>
        <DialogContentText>
          {`Vas a exportar ${
            observations.length
          } puntos a un mapa para compartir por internet.`}
        </DialogContentText>
        <TextField
          label={formatMessage(msgs.titleLabel)}
          value={title}
          fullWidth
          variant='outlined'
          onChange={e => setTitle(e.target.value)}
          margin='normal'
          disabled={saving}
        />
        <TextField
          label={formatMessage(msgs.descriptionLabel)}
          value={description}
          fullWidth
          rows={3}
          rowsMax={6}
          multiline
          variant='outlined'
          margin='normal'
          disabled={saving}
          onChange={e => setDescription(e.target.value)}
        />
        {/**
            <TextField
            label={formatMessage(msgs.termsLabel)}
            helperText={formatMessage(msgs.termsHint)}
            value={terms}
            rows={2}
            rowsMax={4}
            fullWidth
            multiline
            variant='outlined'
            margin='normal'
            onChange={e => setTerms(e.target.value)}
          />
          <TextField
            label={formatMessage(msgs.styleLabel)}
            value={mapStyle}
            helperText={
              <>
                Enter a{' '}
                <a
                  href='https://docs.mapbox.com/help/glossary/style-url/'
                  target='_black'
                  rel='noreferrer'
                >
                  Mapbox Style Url
                </a>
              </>
            }
            fullWidth
            variant='outlined'
            margin='normal'
            onChange={e => setMapStyle(e.target.value)}
          />
          */}
      </DialogContent>

      <DialogActions>
        <Button disabled={saving} onClick={handleClose}>
          {formatMessage(msgs.cancel)}
        </Button>
        <Button
          disabled={saving}
          onClick={handleSave}
          color='primary'
          variant='contained'
          type='submit'
        >
          {formatMessage(msgs.save)}
        </Button>
      </DialogActions>
    </form>
  )
}

export default function EditDialog ({
  observations,
  presets,
  filter,
  getMediaUrl,
  onClose,
  open,
  ...otherProps
}) {
  return (
    <Dialog
      fullWidth
      open={open}
      onClose={onClose}
      scroll='body'
      aria-labelledby='responsive-dialog-title'
    >
      {open && (
        <ViewWrapper
          observations={observations}
          presets={presets}
          filter={filter}
          getMediaUrl={getMediaUrl}
        >
          {({ onClickObservation, filteredObservations, getPreset }) => (
            <EditDialogContent
              observations={filteredObservations}
              getPreset={getPreset}
              getMediaUrl={getMediaUrl}
              onClose={onClose}
              {...otherProps}
            />
          )}
        </ViewWrapper>
      )}
    </Dialog>
  )
}

const useStyles = makeStyles(theme => ({
  appBar: {
    position: 'relative'
  },
  title: {
    marginLeft: theme.spacing(2),
    flex: 1
  },
  content: {
    display: 'flex',
    flexDirection: 'column',
    paddingTop: 0
  }
}))

function observationsToGeoJson (observations = [], getPreset) {
  const features = observations.map(obs => {
    const preset = getPreset(obs)
    const title = preset ? preset.name : 'Observación'
    const description = obs.tags && (obs.tags.notes || obs.tags.note)
    const date = obs.created_at
    const image =
      obs.attachments && obs.attachments.length > 0
        ? obs.attachments[obs.attachments.length - 1].id
        : undefined
    const coords = obs.lon != null && obs.lat != null && [obs.lon, obs.lat]
    return {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: coords
      },
      properties: {
        title,
        description,
        date,
        image
      }
    }
  })
  return {
    type: 'FeatureCollection',
    features
  }
}
