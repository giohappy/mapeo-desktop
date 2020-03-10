/* eslint-disable react-hooks/rules-of-hooks */
import React from 'react'
import ObservationDialog from './ObservationDialog'
import Button from '@material-ui/core/Button'
import { action } from '@storybook/addon-actions'
import { getFields, createMemoizedStats } from '../lib/data_analysis'

export default {
  title: 'ObservationDialog',
  component: ObservationDialog
}

const imageBaseUrl =
  'https://images.digital-democracy.org/mapfilter-sample/sample-'

const getMedia = ({ id }) => ({
  src: imageBaseUrl + ((parseInt(id, 16) % 17) + 1) + '.jpg',
  type: 'image'
})

const getStats = createMemoizedStats()

const getPreset = observation => {
  const stats = getStats(exampleObservations.map(obs => obs.tags || {}))
  const fields = getFields(observation.tags, stats)
  return {
    id: observation.id,
    geometry: ['point'],
    name: (observation.tags && observation.tags.name) || '',
    tags: {},
    fields: fields.slice(0, 5).concat([
      {
        id: 'multi-field',
        key: ['multi'],
        options: ['one', 'two', 'three'],
        type: 'select_multiple'
      }
    ]),
    additionalFields: fields.slice(5)
  }
}

const exampleObservations = require('../../fixtures/observations.json')

export const simple = () => (
  <ObservationDialog
    open
    onRequestClose={action('close')}
    onSave={action('save')}
    observation={exampleObservations[1]}
    getMedia={getMedia}
    onDeleteObservation={action('delete')}
  />
)

export const openClose = () => {
  const [open, setOpen] = React.useState(false)
  const obs =
    exampleObservations[Math.floor(Math.random() * exampleObservations.length)]
  obs.tags.multi = ['one', 'two', 'three']
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open Dialog</Button>
      <ObservationDialog
        open={open}
        onRequestClose={() => setOpen(false)}
        onSave={action('save')}
        getPreset={getPreset}
        observation={obs}
        getMedia={getMedia}
        onDeleteObservation={action('delete')}
      />
    </>
  )
}
