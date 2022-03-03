import React, { useState } from 'react'
import mic from 'microphone-stream'
import axios from 'axios'
import { EventStreamMarshaller } from '@aws-sdk/eventstream-marshaller'
import { fromUtf8, toUtf8 } from '@aws-sdk/util-utf8-node'

import { pcmEncode, downsampleBuffer } from '../lib/audioUtils'

const Recorder = () => {
  const eventStreamMarshaller = new EventStreamMarshaller(toUtf8, fromUtf8)

  let socket
  const [transcribeException, setTranscribeException] = useState(false)
  const [socketError, setSocketError] = useState(false)

  const [transcription, setTranscription] = useState([])

  const [sampleRate, setSampleRate] = useState(44100)


  const [inputSampleRate, setInputSampleRate] = useState()
  let micStream



  
  const getAudioEventMessage = (buffer) => {
    return {
      headers: {
        ':message-type': {
          type: 'string',
          value: 'event'
        },
        ':event-type': {
          type: 'string',
          value: 'AudioEvent'
        }
      },
      body: buffer
    }
  }

  const convertAudioToBinaryMessage = (audioChunk) => {
    let raw = mic.toRaw(audioChunk)

    if (raw == null)
      return;

    let downsampledBuffer = downsampleBuffer(raw, inputSampleRate, sampleRate)
    let pcmEncodedBuffer = pcmEncode(downsampledBuffer)

    let audioEventMessage = getAudioEventMessage(Buffer.from(pcmEncodedBuffer))

    let binary = eventStreamMarshaller.marshall(audioEventMessage)

    return binary
  }

  const handleEventStreamMessage = (messageJson) => {
    let results = messageJson.Transcript.Results

    if (results.length > 0) {
      if (results[0].Alternatives.length > 0) {
        let outPut = results[0].Alternatives[0].Transcript
        outPut = decodeURIComponent(escape(outPut))

        // setTranscription(transcription => ([...transcription, outPut + '\n']))

        if (!results[0].IsPartial) {
          setTranscription(transcription => ([...transcription, outPut + '\n']))
        }
      }
    }
  }

  const streamAudioToWebSocket = async (userMediaStream) => {
    micStream = new mic()
    micStream.on('format', data => {
      setInputSampleRate(data.sampleRate)
    })
    micStream.setStream(userMediaStream)

    const preSignedURL = await axios.post('https://transcribe-app-alb-1970972784.ap-southeast-2.elb.amazonaws.com/api/transcribe', {
      sampleR: sampleRate
    })
    console.log(preSignedURL.data)

    socket = new WebSocket(preSignedURL.data)
    socket.binaryType = 'arraybuffer'

    setSampleRate(0)

    socket.onopen = function() {
      micStream.on('data', function (rawAudioChunk) {
        let binary = convertAudioToBinaryMessage(rawAudioChunk)

        if (socket.readyState === socket.OPEN) {
          socket.send(binary)
        }
      })
    }
    // console.log('Socket ready state: ', socket)

    // wireSocketEvents()
    socket.onmessage = function (message) {
      let messageWrapper = eventStreamMarshaller.unmarshall(Buffer(message.data))
      let messageBody = JSON.parse(String.fromCharCode.apply(String, messageWrapper.body))
      if (messageWrapper.headers[":message-type"].value === "event") {
        handleEventStreamMessage(messageBody)
      } else {
        setTranscribeException(true)
        console.log(messageBody.Message)
      }
    }

    socket.onerror = function () {
      setSocketError(true)
      console.log('WebSocket connection error. Try again.')
    }

    socket.onclose = function (closeEvent) {
      micStream.stop()

      if(!socketError && !transcribeException) {
        if (closeEvent.code !== 1000) {
          console.log('</i><strong>Streaming Exception</strong><br>', closeEvent.reason)
        }
      }
    }
  }

  const startRecording = async () => {
    try {
      window.navigator.mediaDevices.getUserMedia({
        video: false,
        audio: true
      }).then(userMediaStream => {
        streamAudioToWebSocket(userMediaStream)
      })



    } catch (err) {
      console.log('Error. ', err)
    }
  }

  const stopRecording = () => {
    console.log('Recording stopped')
    window.location.reload()
  }
  
  return (
    <>
      <div>Recorder</div>
      <button onClick={startRecording}>Start</button>
      <button onClick={stopRecording}>Stop</button>
      <div className='output'>{transcription}</div>
    </>
  )
}

export default Recorder