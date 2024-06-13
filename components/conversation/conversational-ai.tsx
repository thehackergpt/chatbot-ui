import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useContext
} from "react"
import { LiveKitRoom } from "@livekit/components-react"
import ActiveRoom from "./active-room"
import { fetchToken } from "./fetch-livekit-token"
import { IconPlayerPauseFilled, IconX } from "@tabler/icons-react"
import { ChatbotUIContext } from "@/context/context"

interface ConversationalAIProps {
  onClose: () => void
}

const ConversationalAI: React.FC<ConversationalAIProps> = ({ onClose }) => {
  const { setIsMicSupported } = useContext(ChatbotUIContext)

  const [state, setState] = useState({
    token: null as string | null,
    url: undefined as string | undefined,
    loading: true,
    error: null as string | null
  })

  const [micPermission, setMicPermission] = useState<PermissionState | null>(
    null
  )
  const [tryToConnect, setTryToConnect] = useState(true)
  const [connected, setConnected] = useState(false)

  const LoadingMessage = () => <Message text="Connecting..." />
  const ErrorMessage = () => <Message text="Connection failed, tap to retry" />
  const WaitingForMicPermissionMessage = () => (
    <Message text="Waiting for microphone permission..." />
  )
  const MicPermissionDeniedMessage = () => (
    <Message text="Microphone permission denied. Please grant permission to use the microphone." />
  )

  const fetchTokenCallback = useCallback(async () => {
    const { token, url, error } = await fetchToken()
    setState({ token, url, error, loading: false })
  }, [])

  useEffect(() => {
    fetchTokenCallback()
  }, [fetchTokenCallback])

  const handleOnClose = useCallback(() => {
    setTryToConnect(false)
    setConnected(false)
    onClose()
  }, [onClose])

  useEffect(() => {
    const requestMicPermission = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true
        })
        stream.getTracks().forEach(track => track.stop())
        setMicPermission("granted")
      } catch (error) {
        setMicPermission("denied")
      }
    }

    requestMicPermission()
  }, [])

  useEffect(() => {
    if (micPermission === "denied") {
      setIsMicSupported(false)
      handleOnClose()
    }
  }, [micPermission, handleOnClose])

  const handleOnError = useCallback((error: Error) => {
    setState(prevState => ({ ...prevState, error: error.message }))
  }, [])

  const handleRetry = useCallback(() => {
    setState(prevState => ({ ...prevState, loading: true, error: null }))
    setTryToConnect(true)
    fetchTokenCallback()
  }, [fetchTokenCallback])

  const content = useMemo(() => {
    const { loading, error, token, url } = state
    if (loading) return <LoadingMessage />
    if (error) return <ErrorMessage />
    if (micPermission === "denied") return <MicPermissionDeniedMessage />
    if (micPermission === null) return <WaitingForMicPermissionMessage />
    if (token && url && micPermission === "granted") {
      return (
        <LiveKitRoom
          video={false}
          audio={true}
          token={token}
          serverUrl={url}
          connect={tryToConnect}
          connectOptions={{ autoSubscribe: true }}
          onConnected={() => setConnected(true)}
          onDisconnected={() => {
            setTryToConnect(false)
            setConnected(false)
          }}
          onError={handleOnError}
        >
          <ActiveRoom />
        </LiveKitRoom>
      )
    }
    return null
  }, [state, handleOnClose, handleOnError, tryToConnect, micPermission])

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[#fafafa] dark:bg-[#181818]"
      onClick={state.error ? handleRetry : undefined}
    >
      {content}
      {(state.error || state.loading || micPermission !== "granted") && (
        <button
          className="bg-primary text-secondary absolute bottom-10 left-8 rounded-full p-4 shadow-lg disabled:cursor-not-allowed disabled:opacity-50 md:hover:opacity-50"
          disabled={true}
        >
          <IconPlayerPauseFilled size={32} />
        </button>
      )}
      <button
        onClick={handleOnClose}
        className="bg-primary text-secondary absolute bottom-10 right-8 rounded-full p-4 shadow-lg md:hover:opacity-50"
      >
        <IconX size={32} strokeWidth={3} />
      </button>
    </div>
  )
}

const Message = ({ text }: { text: string }) => (
  <div className="absolute inset-0 top-1/2 flex items-center justify-center p-4">
    {text}
  </div>
)

export default ConversationalAI
