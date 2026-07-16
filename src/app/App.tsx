import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { registerSW } from 'virtual:pwa-register'
import secureMessageAudio from '../assets/secure-message.mp3'
import ownerImage from '../assets/owner.png'

type SystemSound = 'beep' | 'click' | 'success' | 'error'
type ProtocolStatus = 'idle' | 'error' | 'validating' | 'verified' | 'success'

type AppScreen =
  | 'start'
  | 'loading'
  | 'transition'
  | 'secure-message'
  | 'protocol-01'
  | 'protocol-02'
  | 'protocol-03'
  | 'protocol-04'
  | 'protocol-05'
  | 'protocol-06'
  | 'success'

const codeLines = [
  'git fsck --lost-found',
  'HEAD detached at owner',
  'reflog scan: 0x7ff corrupted',
  'restore --source=origin/main',
  'index.lock detected',
  'commit graph fragmented',
  'objects/pack integrity: failed',
  'owner signature located',
  'recovery protocol armed',
  'git cat-file -p OWNER',
  'remote origin unreachable',
  'refs/heads/main unstable',
]

const loadingMessages = [
  'Connecting...',
  'Loading Repository...',
  'Checking Branches...',
  'Checking Commits...',
  'Detecting Corruption...',
  'Recovery Protocol Ready',
]

const recoveryTimeLimitSeconds = 30 * 60
const savedScreenKey = 'git-recovery-screen'
const savedProgressKey = 'git-recovery-progress'
const savedTimeLeftKey = 'git-recovery-time-left'
const savedDeadlineKey = 'git-recovery-deadline-at'
const secureMessageStorageKey = 'git-recovery-secure-message-listened'
const appScreens: AppScreen[] = [
  'start',
  'loading',
  'transition',
  'secure-message',
  'protocol-01',
  'protocol-02',
  'protocol-03',
  'protocol-04',
  'protocol-05',
  'protocol-06',
  'success',
]
const secureMessageTranscript = [
  'Paweł Werda.',
  'Jeżeli słyszysz tę wiadomość, procedura odzyskiwania została uruchomiona prawidłowo.',
  'Repozytorium przypisane do Twojej tożsamości zostało uszkodzone. Część danych utracono, a dostęp do Vault 404 pozostaje zablokowany.',
  'System przygotował sześć protokołów odzyskiwania. Każdy z nich zweryfikuje inny fragment danych.',
  'Nie wszystkie informacje znajdują się w aplikacji. Obserwuj otoczenie. Korzystaj z przedmiotów, które otrzymałeś. Słuchaj uważnie.',
  'Po rozpoczęciu procedury nie będzie możliwości powrotu.',
  'Kiedy będziesz gotowy, rozpocznij identyfikację repozytorium.',
]

let audioContext: AudioContext | null = null

function loadSavedScreen() {
  const savedScreen = window.localStorage.getItem(savedScreenKey)

  return appScreens.includes(savedScreen as AppScreen) ? (savedScreen as AppScreen) : 'start'
}

function loadSavedProgress() {
  const savedProgress = Number(window.localStorage.getItem(savedProgressKey))

  return Number.isFinite(savedProgress) ? Math.min(100, Math.max(0, savedProgress)) : 0
}

function loadSavedDeadline() {
  const now = Date.now()
  const savedDeadline = Number(window.localStorage.getItem(savedDeadlineKey))

  if (Number.isFinite(savedDeadline) && savedDeadline > now) {
    return savedDeadline
  }

  const savedTimeLeft = Number(window.localStorage.getItem(savedTimeLeftKey))
  const migratedTimeLeft =
    Number.isFinite(savedTimeLeft) && savedTimeLeft > 0
      ? Math.min(recoveryTimeLimitSeconds, savedTimeLeft)
      : recoveryTimeLimitSeconds
  const deadline = now + migratedTimeLeft * 1000

  window.localStorage.setItem(savedDeadlineKey, deadline.toString())
  window.localStorage.setItem(savedTimeLeftKey, migratedTimeLeft.toString())

  return deadline
}

function getAudioContext() {
  audioContext ??= new AudioContext()
  return audioContext
}

function playTone(frequency: number, startAt: number, duration: number, volume = 0.035) {
  const context = getAudioContext()
  const oscillator = context.createOscillator()
  const gain = context.createGain()

  oscillator.type = 'square'
  oscillator.frequency.setValueAtTime(frequency, startAt)
  gain.gain.setValueAtTime(0.0001, startAt)
  gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration)

  oscillator.connect(gain)
  gain.connect(context.destination)
  oscillator.start(startAt)
  oscillator.stop(startAt + duration + 0.02)
}

function playSystemSound(sound: SystemSound) {
  try {
    const context = getAudioContext()
    void context.resume()
    const now = context.currentTime

    if (sound === 'click') {
      playTone(880, now, 0.035, 0.025)
      return
    }

    if (sound === 'beep') {
      playTone(660, now, 0.055)
      return
    }

    if (sound === 'error') {
      window.navigator.vibrate?.([42, 28, 42])
      playTone(180, now, 0.08, 0.045)
      playTone(140, now + 0.095, 0.09, 0.04)
      return
    }

    playTone(520, now, 0.06, 0.035)
    playTone(780, now + 0.07, 0.07, 0.04)
    playTone(1040, now + 0.15, 0.11, 0.045)
  } catch {
    // Audio can be blocked until a user gesture; silently keep the UI flow intact.
  }
}

export function App() {
  const [screen, setScreen] = useState<AppScreen>(loadSavedScreen)
  const [transitionTarget, setTransitionTarget] = useState<AppScreen>('protocol-01')
  const [recoveryProgress, setRecoveryProgress] = useState(loadSavedProgress)
  const [deadlineAt] = useState(loadSavedDeadline)
  const [currentTime, setCurrentTime] = useState(Date.now)
  const [isUpdateAvailable, setIsUpdateAvailable] = useState(false)
  const [updateServiceWorker, setUpdateServiceWorker] =
    useState<ReturnType<typeof registerSW> | null>(null)
  const timeLeft = Math.max(0, Math.ceil((deadlineAt - currentTime) / 1000))

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCurrentTime(Date.now())
    }, 1000)

    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    void fetch(secureMessageAudio, { cache: 'force-cache' }).catch(() => undefined)
  }, [])

  useEffect(() => {
    window.localStorage.setItem(savedScreenKey, screen)
  }, [screen])

  useEffect(() => {
    window.localStorage.setItem(savedProgressKey, recoveryProgress.toString())
  }, [recoveryProgress])

  useEffect(() => {
    window.localStorage.setItem(savedTimeLeftKey, timeLeft.toString())
  }, [timeLeft])

  useEffect(() => {
    window.localStorage.setItem(savedDeadlineKey, deadlineAt.toString())
  }, [deadlineAt])

  useEffect(() => {
    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        setIsUpdateAvailable(true)
      },
    })

    setUpdateServiceWorker(() => updateSW)
  }, [])

  function continueWithLoading(nextScreen: AppScreen) {
    setTransitionTarget(nextScreen)
    window.setTimeout(() => {
      playSystemSound('beep')
      setScreen('transition')
      window.setTimeout(() => setScreen(nextScreen), 420)
    }, 420)
  }

  let content: ReactNode

  if (screen === 'start') {
    content = (
      <StartScreen
        onInitialize={() => {
          playSystemSound('click')
          setScreen('loading')
        }}
      />
    )
  } else if (screen === 'loading') {
    content = <LoadingScreen onComplete={() => setScreen('secure-message')} />
  } else if (screen === 'transition') {
    content = <TransitionLoadingScreen nextScreen={transitionTarget} />
  } else {
    if (screen === 'secure-message') {
      content = <SecureMessageScreen onContinue={() => setScreen('protocol-01')} />
    } else if (screen === 'protocol-01') {
      content = (
        <Protocol01Screen
          onSuccess={() => {
            setRecoveryProgress(15)
            continueWithLoading('protocol-02')
          }}
        />
      )
    } else if (screen === 'protocol-02') {
      content = (
        <Protocol02Screen
          onSuccess={() => {
            setRecoveryProgress(35)
            continueWithLoading('protocol-03')
          }}
        />
      )
    } else if (screen === 'protocol-03') {
      content = (
        <Protocol03Screen
          onSuccess={() => {
            setRecoveryProgress(55)
            continueWithLoading('protocol-04')
          }}
        />
      )
    } else if (screen === 'protocol-04') {
      content = (
        <Protocol04Screen
          onSuccess={() => {
            setRecoveryProgress(70)
            continueWithLoading('protocol-05')
          }}
        />
      )
    } else if (screen === 'protocol-05') {
      content = (
        <Protocol05Screen
          onSuccess={() => {
            setRecoveryProgress(90)
            continueWithLoading('protocol-06')
          }}
        />
      )
    } else if (screen === 'protocol-06') {
      content = (
        <Protocol06Screen
          onSuccess={() => {
            setRecoveryProgress(100)
            continueWithLoading('success')
          }}
        />
      )
    } else {
      content = <SuccessScreen />
    }
  }

  return (
    <>
      <GlobalCrtEffects />
      <RecoveryProgressBar progress={recoveryProgress} timeLeft={timeLeft} />
      <PwaStatus
        isUpdateAvailable={isUpdateAvailable}
        onInstallUpdate={() => {
          void updateServiceWorker?.(true)
        }}
      />
      {content}
    </>
  )
}

function PwaStatus({
  isUpdateAvailable,
  onInstallUpdate,
}: {
  isUpdateAvailable: boolean
  onInstallUpdate: () => void
}) {
  if (!isUpdateAvailable) {
    return null
  }

  return (
    <aside className="fixed bottom-4 left-4 right-4 z-[60] mx-auto max-w-[430px] border border-terminal-500/30 bg-flossa-black/88 p-3 font-code uppercase text-flossa-white shadow-[0_0_34px_rgb(57_255_20_/_0.12)] backdrop-blur-md">
      <div className="flex flex-col gap-3">
        <p className="text-[11px] font-semibold tracking-[0.2em] text-terminal-500">
          SYSTEM UPDATE AVAILABLE
        </p>
        <button
          type="button"
          onClick={onInstallUpdate}
          className="h-11 border border-terminal-500/55 bg-terminal-500 px-4 text-[11px] font-semibold tracking-[0.18em] text-flossa-black transition hover:bg-flossa-white focus:outline-none focus:ring-2 focus:ring-terminal-500 focus:ring-offset-2 focus:ring-offset-flossa-black"
        >
          INSTALL SYSTEM UPDATE
        </button>
      </div>
    </aside>
  )
}

function GlobalCrtEffects() {
  return (
    <div className="pointer-events-none fixed inset-0 z-[45]">
      <div className="crt-vignette absolute inset-0" />
      <div className="crt-scanlines absolute inset-0" />
    </div>
  )
}

function RecoveryProgressBar({ progress, timeLeft }: { progress: number; timeLeft: number }) {
  const minutes = Math.floor(timeLeft / 60)
  const seconds = timeLeft % 60
  const formattedTime = `${minutes.toString().padStart(2, '0')}:${seconds
    .toString()
    .padStart(2, '0')}`

  return (
    <aside className="fixed left-0 right-0 top-0 z-50 border-b border-terminal-500/20 bg-flossa-black/78 px-4 pb-3 pt-[calc(10px+env(safe-area-inset-top))] font-code uppercase text-flossa-white shadow-[0_12px_40px_rgb(5_5_5_/_0.52)] backdrop-blur-md">
      <div className="mx-auto w-full max-w-[430px]">
        <div className="mb-2 flex items-center justify-between text-[9px] tracking-[0.22em] text-flossa-white/52">
          <span>Recovery Progress</span>
          <span>{progress.toString().padStart(2, '0')}%</span>
        </div>
        <div className="mb-2 flex items-center justify-between text-[9px] tracking-[0.22em] text-flossa-white/52">
          <span>Time Left</span>
          <span className={timeLeft <= 300 ? 'text-red-300' : 'text-terminal-500/70'}>
            {formattedTime}
          </span>
        </div>

        <div className="h-2 overflow-hidden border border-terminal-500/35 bg-flossa-graphite/70 p-[1px] shadow-[0_0_22px_rgb(57_255_20_/_0.1)]">
          <div
            className="global-recovery-progress h-full bg-terminal-500 transition-[width] duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </aside>
  )
}

function StartScreen({ onInitialize }: { onInitialize: () => void }) {
  const codeStream = useMemo(
    () =>
      Array.from({ length: 42 }, (_, index) => ({
        id: index,
        value: codeLines[index % codeLines.length],
        delay: `${(index % 12) * 180}ms`,
      })),
    [],
  )

  return (
    <main className="relative min-h-dvh overflow-hidden bg-flossa-black text-flossa-white">
      <div className="absolute inset-0">
        <img
          src={ownerImage}
          alt=""
          className="glitch-image h-full w-full object-cover object-center opacity-70"
        />
        <div className="owner-overlay absolute inset-0" />
        <div className="scanlines absolute inset-0 opacity-35" />
      </div>

      <div className="code-rain pointer-events-none absolute inset-0 overflow-hidden font-code text-[10px] leading-5 text-terminal-500/55">
        {codeStream.map((line) => (
          <span
            key={line.id}
            className="code-rain-line"
            style={{
              left: `${(line.id * 17) % 100}%`,
              animationDelay: line.delay,
              animationDuration: `${7600 + (line.id % 9) * 420}ms`,
            }}
          >
            {line.value}
          </span>
        ))}
      </div>

      <section className="relative z-10 flex min-h-dvh flex-col items-center justify-center px-5 pb-[calc(28px+env(safe-area-inset-bottom))] pt-[calc(104px+env(safe-area-inset-top))] text-center">
        <div className="mx-auto flex w-full max-w-[390px] flex-1 flex-col items-center justify-center">
          <p className="mb-5 font-code text-[11px] uppercase tracking-[0.32em] text-terminal-500/70 animate-fade-down">
            <span className="terminal-type inline-block">SYSTEM INIT 1.0.0</span>
          </p>

          <h1 className="glitch-title font-code text-[34px] font-semibold uppercase leading-[1.08] tracking-[0.16em] text-terminal-500 drop-shadow-[0_0_22px_rgb(57_255_20_/_0.36)] sm:text-5xl">
            GIT RECOVERY PROTOCOL
          </h1>

          <div className="mt-8 space-y-3 font-code uppercase tracking-[0.18em] animate-fade-up">
            <p className="terminal-type terminal-type-wide mx-auto max-w-max text-[13px] text-flossa-white/76">
              Repository Owner Detected
            </p>
            <p className="text-[11px] text-flossa-white/42">OWNER</p>
            <p className="text-[13px] text-terminal-500">PAWEŁ WERDA</p>
            <p className="pt-3 text-[11px] text-flossa-white/42">Repository Status</p>
            <p className="text-[13px] text-terminal-500">
              <span className="glitch-status text-red-300">CORRUPTED</span>
            </p>
            <div className="mt-5 border border-red-300/25 bg-flossa-black/60 px-4 py-3 text-[11px] leading-5 tracking-[0.16em] text-red-300/90">
              <span className="terminal-type terminal-type-wide inline-block">
                Time limit: 30 minutes.
              </span>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onInitialize}
          className="group mb-1 h-14 w-full max-w-[390px] border border-terminal-500/55 bg-terminal-500 px-5 font-code text-[12px] font-semibold uppercase tracking-[0.24em] text-flossa-black shadow-[0_0_34px_rgb(57_255_20_/_0.18)] transition duration-200 hover:bg-flossa-white focus:outline-none focus:ring-2 focus:ring-terminal-500 focus:ring-offset-2 focus:ring-offset-flossa-black active:scale-[0.98]"
        >
          <span className="inline-flex items-center gap-3">
            INITIALIZE RECOVERY
            <span className="h-2 w-2 bg-flossa-black transition group-hover:translate-x-1" />
          </span>
        </button>
      </section>
    </main>
  )
}

function LoadingScreen({ onComplete }: { onComplete: () => void }) {
  const [progress, setProgress] = useState(0)
  const activeMessageIndex = Math.min(
    loadingMessages.length - 1,
    Math.floor(progress / (100 / loadingMessages.length)),
  )

  useEffect(() => {
    const durationMs = 6200
    const startedAt = window.performance.now()

    const progressTimer = window.setInterval(() => {
      const elapsed = window.performance.now() - startedAt
      const nextProgress = Math.min(100, Math.round((elapsed / durationMs) * 100))

      setProgress(nextProgress)

      if (nextProgress >= 100) {
        window.clearInterval(progressTimer)
      }
    }, 80)

    return () => window.clearInterval(progressTimer)
  }, [])

  useEffect(() => {
    if (progress < 100) {
      return undefined
    }

    playSystemSound('beep')
    const completeTimer = window.setTimeout(onComplete, 900)

    return () => window.clearTimeout(completeTimer)
  }, [onComplete, progress])

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-flossa-black px-5 pt-[calc(76px+env(safe-area-inset-top))] text-center text-flossa-white">
      <div className="loading-grid absolute inset-0 opacity-35" />
      <div className="scanlines absolute inset-0 opacity-20" />

      <section className="relative z-10 w-full max-w-[390px] animate-fade-in font-code uppercase">
        <p className="terminal-type mx-auto mb-5 max-w-max text-[11px] tracking-[0.34em] text-terminal-500/55">
          RECOVERY SEQUENCE
        </p>

        <div className="mx-auto mb-8 h-16 w-16 rounded-full border border-terminal-500/20 border-t-terminal-500 loading-orb shadow-[0_0_28px_rgb(57_255_20_/_0.16)]" />

        <div className="min-h-8 overflow-hidden">
          <p key={activeMessageIndex} className="animate-fade-up text-lg font-semibold tracking-[0.16em] text-terminal-500">
            {loadingMessages[activeMessageIndex]}
          </p>
        </div>

        <div className="mt-9">
          <div className="mb-3 flex items-center justify-between text-[10px] tracking-[0.22em] text-flossa-white/50">
            <span>PROGRESS</span>
            <span>{progress.toString().padStart(3, '0')}%</span>
          </div>

          <div className="h-3 overflow-hidden border border-terminal-500/35 bg-flossa-graphite/70 p-[2px] shadow-[0_0_30px_rgb(57_255_20_/_0.1)]">
            <div
              className="loading-progress h-full bg-terminal-500 transition-[width] duration-100 ease-linear"
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="mt-6 space-y-2 text-left text-[10px] leading-5 tracking-[0.16em] text-flossa-white/42">
            {loadingMessages.map((message, index) => (
              <p
                key={message}
                className={index <= activeMessageIndex ? 'text-terminal-500/70' : undefined}
              >
                {index <= activeMessageIndex ? '> ' : '  '}
                {message}
              </p>
            ))}
          </div>
        </div>
      </section>
    </main>
  )
}

function TransitionLoadingScreen({ nextScreen }: { nextScreen: AppScreen }) {
  const nextLabel = nextScreen === 'success' ? 'SUCCESS' : nextScreen.replace('-', ' ').toUpperCase()

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-flossa-black px-5 pt-[calc(76px+env(safe-area-inset-top))] text-center text-flossa-white">
      <div className="loading-grid absolute inset-0 opacity-30" />
      <div className="scanlines absolute inset-0 opacity-20" />

      <section className="relative z-10 w-full max-w-[390px] animate-fade-in font-code uppercase">
        <div className="mx-auto mb-7 h-12 w-12 rounded-full border border-terminal-500/20 border-t-terminal-500 loading-orb shadow-[0_0_28px_rgb(57_255_20_/_0.16)]" />
        <p className="terminal-type mx-auto max-w-max text-[11px] tracking-[0.28em] text-terminal-500/60">
          SYSTEM HANDOFF
        </p>
        <h2 className="mt-5 text-xl font-semibold tracking-[0.18em] text-terminal-500">
          Loading {nextLabel}
        </h2>
      </section>
    </main>
  )
}

function ValidationSequence() {
  return (
    <div className="validation-sequence mx-auto inline-flex flex-col items-center gap-2 border border-terminal-500/45 bg-terminal-500/10 px-5 py-3 text-[12px] font-semibold tracking-[0.18em] text-terminal-500">
      <span className="terminal-type max-w-max">VALIDATING...</span>
      <span className="validation-blocks">██████████</span>
      <span className="validation-verified">✓ VERIFIED</span>
    </div>
  )
}

function completeValidation<TStatus extends ProtocolStatus | 'token'>(
  setStatus: React.Dispatch<React.SetStateAction<TStatus>>,
  onSuccess: () => void,
) {
  setStatus('validating' as TStatus)
  window.setTimeout(() => {
    setStatus('verified' as TStatus)
    playSystemSound('beep')
  }, 620)
  window.setTimeout(() => {
    playSystemSound('success')
    setStatus('success' as TStatus)
    onSuccess()
  }, 1050)
}

function SecureMessageScreen({ onContinue }: { onContinue: () => void }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [hasEnded, setHasEnded] = useState(() => {
    return window.localStorage.getItem(secureMessageStorageKey) === 'true'
  })
  const [visibleTranscriptCount, setVisibleTranscriptCount] = useState(0)

  useEffect(() => {
    if (!isOpen) {
      return undefined
    }

    const transcriptTimer = window.setInterval(() => {
      setVisibleTranscriptCount((count) =>
        Math.min(secureMessageTranscript.length, count + 1),
      )
    }, 1750)

    return () => window.clearInterval(transcriptTimer)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) {
      return undefined
    }

    const audioElement = audioRef.current

    return () => {
      if (audioElement) {
        audioElement.pause()
        audioElement.currentTime = 0
      }
    }
  }, [isOpen])

  async function openMessage() {
    playSystemSound('beep')
    setIsOpen(true)
    setVisibleTranscriptCount(1)

    await new Promise((resolve) => window.requestAnimationFrame(resolve))

    try {
      await audioRef.current?.play()
      setIsPlaying(true)
    } catch {
      setIsPlaying(false)
    }
  }

  async function replayAudio() {
    if (!audioRef.current) {
      return
    }

    playSystemSound('click')
    audioRef.current.currentTime = 0

    try {
      await audioRef.current.play()
      setIsPlaying(true)
    } catch {
      setIsPlaying(false)
    }
  }

  function pauseAudio() {
    playSystemSound('click')
    audioRef.current?.pause()
    setIsPlaying(false)
  }

  function handleAudioEnded() {
    setIsPlaying(false)
    setHasEnded(true)
    setVisibleTranscriptCount(secureMessageTranscript.length)
    window.localStorage.setItem(secureMessageStorageKey, 'true')
    playSystemSound('success')
  }

  function handleContinue() {
    if (!hasEnded) {
      playSystemSound('error')
      return
    }

    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
    }

    playSystemSound('click')
    onContinue()
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-flossa-black px-5 pb-7 pt-[calc(104px+env(safe-area-inset-top))] text-flossa-white">
      <div className="secure-message-bg absolute inset-0" />
      <div className="secure-message-orbit absolute inset-0 opacity-40" />
      <div className="scanlines absolute inset-0 opacity-20" />

      <audio
        ref={audioRef}
        src={secureMessageAudio}
        preload="auto"
        onEnded={handleAudioEnded}
        onPause={() => setIsPlaying(false)}
        onPlay={() => setIsPlaying(true)}
      />

      <section className="relative z-10 w-full max-w-[410px] animate-fade-up font-code uppercase">
        {!isOpen ? (
          <div className="secure-envelope border border-terminal-500/35 bg-flossa-black/82 p-5 text-center shadow-[0_0_46px_rgb(57_255_20_/_0.14)]">
            <div className="secure-envelope-icon mx-auto mb-6 grid h-16 w-20 place-items-center border border-terminal-500/40 text-terminal-500">
              MSG
            </div>
            <h1 className="text-2xl font-semibold leading-tight tracking-[0.14em] text-terminal-500">
              ENCRYPTED MESSAGE RECEIVED
            </h1>
            <dl className="mt-7 space-y-4 text-left text-[11px] tracking-[0.18em]">
              <div>
                <dt className="text-flossa-white/42">Sender:</dt>
                <dd className="mt-1 text-terminal-500/80">UNKNOWN NODE</dd>
              </div>
              <div>
                <dt className="text-flossa-white/42">Classification:</dt>
                <dd className="mt-1 text-terminal-500/80">OWNER ONLY</dd>
              </div>
              <div>
                <dt className="text-flossa-white/42">Payload:</dt>
                <dd className="mt-1 text-terminal-500/80">Audio payload detected.</dd>
              </div>
            </dl>
            <button
              type="button"
              onClick={openMessage}
              className="mt-8 h-14 w-full border border-terminal-500/55 bg-terminal-500 px-5 text-[12px] font-semibold tracking-[0.2em] text-flossa-black shadow-[0_0_34px_rgb(57_255_20_/_0.18)] transition duration-200 hover:bg-flossa-white focus:outline-none focus:ring-2 focus:ring-terminal-500 focus:ring-offset-2 focus:ring-offset-flossa-black active:scale-[0.98]"
            >
              OPEN SECURE MESSAGE
            </button>
          </div>
        ) : (
          <div className="secure-message-open border border-terminal-500/35 bg-flossa-black/82 p-5 shadow-[0_0_46px_rgb(57_255_20_/_0.14)]">
            <div className="mb-5 text-center">
              <p className="secure-decrypt-glitch text-xl font-semibold tracking-[0.16em] text-terminal-500">
                MESSAGE DECRYPTED
              </p>
              <p className="terminal-type mx-auto mt-3 max-w-max text-[11px] tracking-[0.18em] text-flossa-white/60">
                Playing recovered transmission...
              </p>
            </div>

            <div className="relative mb-5 overflow-hidden border border-terminal-500/20 bg-flossa-black/60 p-4">
              <div className="secure-gif-sim absolute inset-0" />
              <div className="relative z-10">
                <p className="mb-4 text-center text-[10px] tracking-[0.24em] text-terminal-500/70">
                  {isPlaying ? 'TRANSMISSION ACTIVE' : 'TRANSMISSION STANDBY'}
                </p>
                <div className={`waveform ${isPlaying ? 'waveform-active' : ''}`}>
                  {Array.from({ length: 18 }, (_, index) => (
                    <span key={index} style={{ animationDelay: `${index * 55}ms` }} />
                  ))}
                </div>
              </div>
            </div>

            <div className="mb-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={pauseAudio}
                disabled={!isPlaying}
                className="h-12 border border-flossa-white/12 bg-flossa-black/70 px-3 text-[11px] font-semibold tracking-[0.18em] text-flossa-white/64 transition hover:border-flossa-white/30 focus:outline-none focus:ring-2 focus:ring-terminal-500/20 disabled:opacity-40"
              >
                PAUSE
              </button>
              <button
                type="button"
                onClick={replayAudio}
                className="h-12 border border-terminal-500/35 bg-flossa-black/70 px-3 text-[11px] font-semibold tracking-[0.18em] text-terminal-500/80 transition hover:border-terminal-500 focus:outline-none focus:ring-2 focus:ring-terminal-500/20"
              >
                REPLAY
              </button>
            </div>

            <div className="max-h-[34dvh] space-y-3 overflow-y-auto pr-1 text-[12px] normal-case leading-6 tracking-[0.02em] text-flossa-white/72">
              {secureMessageTranscript.slice(0, visibleTranscriptCount).map((message) => (
                <p key={message} className="animate-fade-up border-l border-terminal-500/35 pl-3">
                  {message}
                </p>
              ))}
            </div>

            <button
              type="button"
              onClick={handleContinue}
              disabled={!hasEnded}
              className="mt-6 h-14 w-full border border-terminal-500/55 bg-terminal-500 px-5 text-[12px] font-semibold tracking-[0.2em] text-flossa-black shadow-[0_0_34px_rgb(57_255_20_/_0.18)] transition duration-200 hover:bg-flossa-white focus:outline-none focus:ring-2 focus:ring-terminal-500 focus:ring-offset-2 focus:ring-offset-flossa-black active:scale-[0.98] disabled:cursor-not-allowed disabled:border-flossa-white/15 disabled:bg-flossa-graphite disabled:text-flossa-white/35 disabled:shadow-none disabled:hover:bg-flossa-graphite"
            >
              CONTINUE RECOVERY
            </button>
          </div>
        )}
      </section>
    </main>
  )
}

function Protocol01Screen({ onSuccess }: { onSuccess: () => void }) {
  const [answer, setAnswer] = useState('')
  const [status, setStatus] = useState<ProtocolStatus>('idle')
  const isLocked = status === 'validating' || status === 'verified' || status === 'success'

  function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    playSystemSound('click')

    if (answer.trim().toUpperCase() !== 'V404-2718') {
      playSystemSound('error')
      setStatus('error')
      return
    }

    completeValidation(setStatus, onSuccess)
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-flossa-black px-5 pb-7 pt-[calc(104px+env(safe-area-inset-top))] text-flossa-white">
      <div className="loading-grid absolute inset-0 opacity-30" />
      <div className="scanlines absolute inset-0 opacity-20" />

      <section className="relative z-10 w-full max-w-[390px] animate-fade-up font-code uppercase">
        <div className="mb-10">
          <p className="text-[11px] tracking-[0.34em] text-terminal-500/55">PROTOCOL 01</p>
          <h1 className="mt-5 text-3xl font-semibold leading-tight tracking-[0.16em] text-terminal-500">
            Repository Identification
          </h1>
          <p className="terminal-type mt-5 max-w-max text-xs leading-6 tracking-[0.16em] text-flossa-white/56">
            Locate the Repository ID.
          </p>
        </div>

        <form onSubmit={handleVerify} className="space-y-5">
          <label className="block">
            <span className="mb-3 block text-[10px] tracking-[0.24em] text-flossa-white/50">
              RECOVERY KEY
            </span>
            <input
              value={answer}
              onChange={(event) => {
                setAnswer(event.target.value)
                if (status === 'error') {
                  setStatus('idle')
                }
              }}
              disabled={isLocked}
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              placeholder=""
              className="h-14 w-full border border-terminal-500/35 bg-flossa-black/80 px-4 text-center text-base font-semibold tracking-[0.2em] text-terminal-500 outline-none shadow-[inset_0_0_24px_rgb(57_255_20_/_0.08)] transition placeholder:text-terminal-500/20 focus:border-terminal-500 focus:ring-2 focus:ring-terminal-500/30 disabled:opacity-70"
            />
          </label>

          <button
            type="submit"
            disabled={isLocked}
            className="h-14 w-full border border-terminal-500/55 bg-terminal-500 px-5 text-[12px] font-semibold tracking-[0.24em] text-flossa-black shadow-[0_0_34px_rgb(57_255_20_/_0.18)] transition duration-200 hover:bg-flossa-white focus:outline-none focus:ring-2 focus:ring-terminal-500 focus:ring-offset-2 focus:ring-offset-flossa-black active:scale-[0.98] disabled:cursor-default disabled:bg-terminal-500/80 disabled:hover:bg-terminal-500/80"
          >
            VERIFY
          </button>
        </form>

        <div className="mt-8 min-h-12 text-center">
          {status === 'error' ? (
            <p className="protocol-error-glitch text-[11px] tracking-[0.2em] text-red-300">
              ACCESS DENIED. KEY MISMATCH.
            </p>
          ) : null}

          {status === 'validating' || status === 'verified' ? <ValidationSequence /> : null}

          {status === 'success' ? (
            <div className="success-pulse mx-auto inline-flex flex-col items-center gap-2 border border-terminal-500/55 bg-terminal-500/10 px-5 py-3 text-[12px] font-semibold tracking-[0.18em] text-terminal-500">
              <span className="h-2.5 w-2.5 bg-terminal-500 shadow-[0_0_18px_rgb(57_255_20_/_0.8)]" />
              <span>Repository linked.</span>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  )
}

function Protocol02Screen({ onSuccess }: { onSuccess: () => void }) {
  const [answer, setAnswer] = useState('')
  const [status, setStatus] = useState<ProtocolStatus>('idle')
  const isLocked = status === 'validating' || status === 'verified' || status === 'success'

  function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    playSystemSound('click')

    if (answer.trim().toLowerCase() !== '4ce792') {
      playSystemSound('error')
      setStatus('error')
      return
    }

    completeValidation(setStatus, onSuccess)
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-flossa-black px-5 pb-7 pt-[calc(104px+env(safe-area-inset-top))] text-flossa-white">
      <div className="loading-grid absolute inset-0 opacity-30" />
      <div className="scanlines absolute inset-0 opacity-20" />

      <section className="relative z-10 w-full max-w-[390px] animate-fade-up font-code uppercase">
        <div className="mb-10">
          <p className="text-[11px] tracking-[0.34em] text-terminal-500/55">PROTOCOL 02</p>
          <h1 className="mt-5 text-3xl font-semibold leading-tight tracking-[0.16em] text-terminal-500">
            Commit Recovery
          </h1>
          <p className="terminal-type mt-5 max-w-max text-xs leading-6 tracking-[0.16em] text-flossa-white/56">
            Last valid commit
          </p>
          <p className="mt-2 text-xs leading-6 tracking-[0.16em] text-flossa-white/56">
            has been damaged.
          </p>
          <p className="mt-5 text-xs leading-6 tracking-[0.16em] text-flossa-white/56">
            Recover<br />the Commit Hash.
          </p>
          <p className="mt-5 text-[11px] leading-6 tracking-[0.18em] text-terminal-500/70">
            Hint:<br />One digit<br />is missing.
          </p>
        </div>

        <form onSubmit={handleVerify} className="space-y-5">
          <label className="block">
            <span className="mb-3 block text-[10px] tracking-[0.24em] text-flossa-white/50">
              COMMIT HASH
            </span>
            <input
              value={answer}
              onChange={(event) => {
                setAnswer(event.target.value)
                if (status === 'error') {
                  setStatus('idle')
                }
              }}
              disabled={isLocked}
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              placeholder="000000"
              className="h-14 w-full border border-terminal-500/35 bg-flossa-black/80 px-4 text-center text-base font-semibold tracking-[0.28em] text-terminal-500 outline-none shadow-[inset_0_0_24px_rgb(57_255_20_/_0.08)] transition placeholder:text-terminal-500/20 focus:border-terminal-500 focus:ring-2 focus:ring-terminal-500/30 disabled:opacity-70"
            />
          </label>

          <button
            type="submit"
            disabled={isLocked}
            className="h-14 w-full border border-terminal-500/55 bg-terminal-500 px-5 text-[12px] font-semibold tracking-[0.24em] text-flossa-black shadow-[0_0_34px_rgb(57_255_20_/_0.18)] transition duration-200 hover:bg-flossa-white focus:outline-none focus:ring-2 focus:ring-terminal-500 focus:ring-offset-2 focus:ring-offset-flossa-black active:scale-[0.98] disabled:cursor-default disabled:bg-terminal-500/80 disabled:hover:bg-terminal-500/80"
          >
            VERIFY
          </button>
        </form>

        <div className="mt-8 min-h-12 text-center">
          {status === 'error' ? (
            <p className="protocol-error-glitch text-[11px] tracking-[0.2em] text-red-300">
              HASH REJECTED. FRAGMENT INVALID.
            </p>
          ) : null}

          {status === 'validating' || status === 'verified' ? <ValidationSequence /> : null}

          {status === 'success' ? (
            <div className="success-pulse mx-auto inline-flex flex-col items-center gap-2 border border-terminal-500/55 bg-terminal-500/10 px-5 py-3 text-[12px] font-semibold tracking-[0.18em] text-terminal-500">
              <span className="h-2.5 w-2.5 bg-terminal-500 shadow-[0_0_18px_rgb(57_255_20_/_0.8)]" />
              <span>Commit restored.</span>
              <span>Branch integrity restored.</span>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  )
}

function Protocol03Screen({ onSuccess }: { onSuccess: () => void }) {
  const [answer, setAnswer] = useState('')
  const [status, setStatus] = useState<ProtocolStatus>('idle')
  const isLocked = status === 'validating' || status === 'verified' || status === 'success'

  function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    playSystemSound('click')

    if (answer.trim() !== '739') {
      playSystemSound('error')
      setStatus('error')
      return
    }

    completeValidation(setStatus, onSuccess)
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-flossa-black px-5 pb-7 pt-[calc(104px+env(safe-area-inset-top))] text-flossa-white">
      <div className="loading-grid absolute inset-0 opacity-30" />
      <div className="scanlines absolute inset-0 opacity-20" />

      <section className="relative z-10 w-full max-w-[390px] animate-fade-up font-code uppercase">
        <div className="mb-9">
          <p className="text-[11px] tracking-[0.34em] text-terminal-500/55">PROTOCOL 03</p>
          <h1 className="mt-5 text-3xl font-semibold leading-tight tracking-[0.16em] text-terminal-500">
            External Repository Verification
          </h1>
          <div className="mt-6 border border-terminal-500/25 bg-flossa-black/70 p-4 shadow-[inset_0_0_28px_rgb(57_255_20_/_0.06)]">
            <p className="text-xs leading-6 tracking-[0.14em] text-flossa-white/62">
              Repository<br />
              cannot be restored<br />
              using local data.
            </p>
            <p className="mt-4 text-xs leading-6 tracking-[0.14em] text-flossa-white/62">
              External Repository<br />
              must be queried.
            </p>
            <p className="mt-4 text-xs leading-6 tracking-[0.14em] text-terminal-500/80">
              Call<br />
              732 128 058
            </p>
            <p className="terminal-type mt-4 max-w-max text-xs leading-6 tracking-[0.12em] text-flossa-white/72">
              Ask exactly one question.
            </p>
            <p className="mt-3 text-xs leading-6 tracking-[0.12em] text-terminal-500/80">
              "What is Monsterek?"
            </p>
          </div>
        </div>

        <form onSubmit={handleVerify} className="space-y-5">
          <label className="block">
            <span className="mb-3 block text-[10px] tracking-[0.24em] text-flossa-white/50">
              PHONE CODE
            </span>
            <input
              value={answer}
              onChange={(event) => {
                setAnswer(event.target.value)
                if (status === 'error') {
                  setStatus('idle')
                }
              }}
              disabled={isLocked}
              autoComplete="one-time-code"
              autoCorrect="off"
              spellCheck={false}
              inputMode="numeric"
              maxLength={3}
              placeholder="000"
              className="h-14 w-full border border-terminal-500/35 bg-flossa-black/80 px-4 text-center text-base font-semibold tracking-[0.38em] text-terminal-500 outline-none shadow-[inset_0_0_24px_rgb(57_255_20_/_0.08)] transition placeholder:text-terminal-500/20 focus:border-terminal-500 focus:ring-2 focus:ring-terminal-500/30 disabled:opacity-70"
            />
          </label>

          <button
            type="submit"
            disabled={isLocked}
            className="h-14 w-full border border-terminal-500/55 bg-terminal-500 px-5 text-[12px] font-semibold tracking-[0.24em] text-flossa-black shadow-[0_0_34px_rgb(57_255_20_/_0.18)] transition duration-200 hover:bg-flossa-white focus:outline-none focus:ring-2 focus:ring-terminal-500 focus:ring-offset-2 focus:ring-offset-flossa-black active:scale-[0.98] disabled:cursor-default disabled:bg-terminal-500/80 disabled:hover:bg-terminal-500/80"
          >
            VERIFY
          </button>
        </form>

        <div className="mt-8 min-h-12 text-center">
          {status === 'error' ? (
            <p className="protocol-error-glitch text-[11px] tracking-[0.2em] text-red-300">
              PHONE RELAY FAILED. CODE INVALID.
            </p>
          ) : null}

          {status === 'validating' || status === 'verified' ? <ValidationSequence /> : null}

          {status === 'success' ? (
            <div className="success-pulse mx-auto inline-flex flex-col items-center gap-2 border border-terminal-500/55 bg-terminal-500/10 px-5 py-3 text-[12px] font-semibold tracking-[0.18em] text-terminal-500">
              <span className="h-2.5 w-2.5 bg-terminal-500 shadow-[0_0_18px_rgb(57_255_20_/_0.8)]" />
              <span>External repository verified.</span>
              <span>Voice authentication completed.</span>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  )
}

function Protocol04Screen({ onSuccess }: { onSuccess: () => void }) {
  const [answer, setAnswer] = useState('')
  const [status, setStatus] = useState<ProtocolStatus | 'token'>('idle')
  const isTokenVisible = status === 'token' || status === 'success'
  const isLocked = status === 'validating' || status === 'verified' || status === 'success'

  function triggerHapticError() {
    playSystemSound('error')
    setStatus('error')
  }

  function handleMonster() {
    playSystemSound('beep')
    setStatus('token')
  }

  function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    playSystemSound('click')

    if (answer.trim() !== '672') {
      triggerHapticError()
      return
    }

    completeValidation(setStatus, onSuccess)
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-flossa-black px-5 pb-7 pt-[calc(104px+env(safe-area-inset-top))] text-flossa-white">
      <div className="loading-grid absolute inset-0 opacity-30" />
      <div className="scanlines absolute inset-0 opacity-20" />

      <section className="relative z-10 w-full max-w-[390px] animate-fade-up font-code uppercase">
        <div className="mb-8">
          <p className="text-[11px] tracking-[0.34em] text-terminal-500/55">PROTOCOL 04</p>
          <h1 className="mt-5 text-3xl font-semibold leading-tight tracking-[0.16em] text-terminal-500">
            Merge Conflict
          </h1>
          <div className="mt-6 border border-red-300/25 bg-flossa-black/70 p-4 shadow-[inset_0_0_28px_rgb(255_120_120_/_0.05)]">
            <p className="protocol-error-glitch text-[12px] tracking-[0.22em] text-red-300">WARNING</p>
            <p className="mt-4 text-xs leading-6 tracking-[0.14em] text-flossa-white/62">
              Critical developer state detected.
            </p>
            <p className="mt-4 text-xs leading-6 tracking-[0.14em] text-flossa-white/62">
              You have been coding<br />
              for 9 hours.
            </p>
            <p className="mt-4 text-xs leading-6 tracking-[0.14em] text-flossa-white/62">
              Current time:<br />
              <span className="text-terminal-500/80">04:30</span>
            </p>
            <p className="mt-4 text-xs leading-6 tracking-[0.14em] text-flossa-white/62">
              You are exhausted.
            </p>
            <p className="mt-4 text-xs leading-6 tracking-[0.14em] text-flossa-white/62">
              Merge conflict detected.
            </p>
            <p className="terminal-type mt-4 max-w-max text-xs leading-6 tracking-[0.14em] text-flossa-white/72">
              Choose the only valid option.
            </p>
          </div>
        </div>

        <div className="grid gap-3">
          <button
            type="button"
            onClick={handleMonster}
            disabled={isLocked}
            className="border border-flossa-white/12 bg-flossa-black/70 px-4 py-3 text-left text-[11px] font-semibold normal-case leading-5 tracking-[0.08em] text-flossa-white/64 transition hover:border-flossa-white/30 focus:outline-none focus:ring-2 focus:ring-terminal-500/20 disabled:opacity-70"
          >
            A<br />
            <span className="text-terminal-500/70">if</span> (fatigue &gt; limit) {'{'}<br />
            &nbsp;&nbsp;monster();<br />
            {'}'}
          </button>
          <button
            type="button"
            onClick={triggerHapticError}
            disabled={isLocked}
            className="border border-flossa-white/12 bg-flossa-black/70 px-4 py-3 text-left text-[11px] font-semibold normal-case leading-5 tracking-[0.08em] text-flossa-white/64 transition hover:border-flossa-white/30 focus:outline-none focus:ring-2 focus:ring-terminal-500/20 disabled:opacity-70"
          >
            B<br />
            <span className="text-terminal-500/70">while</span> (deadline) {'{'}<br />
            &nbsp;&nbsp;sleep();<br />
            {'}'}
          </button>
          <button
            type="button"
            onClick={triggerHapticError}
            disabled={isLocked}
            className="border border-flossa-white/12 bg-flossa-black/70 px-4 py-3 text-left text-[11px] font-semibold normal-case leading-5 tracking-[0.08em] text-flossa-white/64 transition hover:border-flossa-white/30 focus:outline-none focus:ring-2 focus:ring-terminal-500/20 disabled:opacity-70"
          >
            C<br />
            <span className="text-terminal-500/70">try</span> {'{'}<br />
            &nbsp;&nbsp;continueWorking();<br />
            {'}'} <span className="text-terminal-500/70">catch</span> (...) {'{}'}
          </button>
        </div>

        <div className="mt-7 min-h-[76px]">
          {status === 'error' ? (
            <p className="protocol-error-glitch protocol-error-shake text-center text-[11px] tracking-[0.2em] text-red-300">
              RUNTIME ERROR. INVALID FUNCTION.
            </p>
          ) : null}

          {isTokenVisible ? (
            <div className="success-pulse border border-terminal-500/40 bg-terminal-500/10 p-4 text-center">
              <p className="text-[10px] tracking-[0.24em] text-flossa-white/48">
                Recovery Token generated.
              </p>
              <p className="mt-3 text-[12px] leading-6 tracking-[0.14em] text-terminal-500">
                (21 * 32) + (8 - 8)
              </p>
            </div>
          ) : null}
        </div>

        {isTokenVisible ? (
          <form onSubmit={handleVerify} className="mt-5 space-y-5 animate-fade-up">
            <label className="block">
              <span className="mb-3 block text-[10px] tracking-[0.24em] text-flossa-white/50">
                TOKEN INPUT
              </span>
              <input
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                disabled={isLocked}
                autoComplete="one-time-code"
                autoCorrect="off"
                spellCheck={false}
                inputMode="numeric"
                maxLength={3}
                placeholder="000"
                className="h-14 w-full border border-terminal-500/35 bg-flossa-black/80 px-4 text-center text-base font-semibold tracking-[0.38em] text-terminal-500 outline-none shadow-[inset_0_0_24px_rgb(57_255_20_/_0.08)] transition placeholder:text-terminal-500/20 focus:border-terminal-500 focus:ring-2 focus:ring-terminal-500/30 disabled:opacity-70"
              />
            </label>

            <button
              type="submit"
              disabled={isLocked}
              className="h-14 w-full border border-terminal-500/55 bg-terminal-500 px-5 text-[12px] font-semibold tracking-[0.24em] text-flossa-black shadow-[0_0_34px_rgb(57_255_20_/_0.18)] transition duration-200 hover:bg-flossa-white focus:outline-none focus:ring-2 focus:ring-terminal-500 focus:ring-offset-2 focus:ring-offset-flossa-black active:scale-[0.98] disabled:cursor-default disabled:bg-terminal-500/80 disabled:hover:bg-terminal-500/80"
            >
              VERIFY
            </button>
          </form>
        ) : null}

        <div className="mt-8 min-h-12 text-center">
          {status === 'validating' || status === 'verified' ? <ValidationSequence /> : null}

          {status === 'success' ? (
            <div className="success-pulse mx-auto inline-flex flex-col items-center gap-2 border border-terminal-500/55 bg-terminal-500/10 px-5 py-3 text-[12px] font-semibold tracking-[0.18em] text-terminal-500">
              <span className="h-2.5 w-2.5 bg-terminal-500 shadow-[0_0_18px_rgb(57_255_20_/_0.8)]" />
              <span>Recovery Package 02</span>
              <span>UNLOCKED</span>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  )
}

function Protocol05Screen({ onSuccess }: { onSuccess: () => void }) {
  const [answer, setAnswer] = useState('')
  const [status, setStatus] = useState<ProtocolStatus>('idle')
  const isLocked = status === 'validating' || status === 'verified' || status === 'success'

  function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    playSystemSound('click')

    if (answer.trim() !== 'ROOT_ACCESS_CHRABĄSZCZ') {
      playSystemSound('error')
      setStatus('error')
      return
    }

    completeValidation(setStatus, onSuccess)
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-flossa-black px-5 pb-7 pt-[calc(104px+env(safe-area-inset-top))] text-flossa-white">
      <div className="loading-grid absolute inset-0 opacity-30" />
      <div className="scanlines absolute inset-0 opacity-20" />

      <section className="relative z-10 w-full max-w-[390px] animate-fade-up font-code uppercase">
        <div className="mb-10">
          <p className="text-[11px] tracking-[0.34em] text-terminal-500/55">PROTOCOL 05</p>
          <h1 className="mt-5 text-3xl font-semibold leading-tight tracking-[0.16em] text-terminal-500">
            Master Password Recovery
          </h1>
          <p className="terminal-type mt-5 max-w-max text-xs leading-6 tracking-[0.16em] text-flossa-white/56">
            Assemble the torn password.
          </p>
          <p className="mt-5 text-xs leading-6 tracking-[0.16em] text-flossa-white/56">
            Recover<br />the Master Password.
          </p>
        </div>

        <form onSubmit={handleVerify} className="space-y-5">
          <label className="block">
            <span className="mb-3 block text-[10px] tracking-[0.24em] text-flossa-white/50">
              ROOT PASSWORD
            </span>
            <input
              value={answer}
              onChange={(event) => {
                setAnswer(event.target.value)
                if (status === 'error') {
                  setStatus('idle')
                }
              }}
              disabled={isLocked}
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              placeholder=""
              className="h-14 w-full border border-terminal-500/35 bg-flossa-black/80 px-3 text-center text-[13px] font-semibold tracking-[0.08em] text-terminal-500 outline-none shadow-[inset_0_0_24px_rgb(57_255_20_/_0.08)] transition placeholder:text-terminal-500/20 focus:border-terminal-500 focus:ring-2 focus:ring-terminal-500/30 disabled:opacity-70"
            />
          </label>

          <button
            type="submit"
            disabled={isLocked}
            className="h-14 w-full border border-terminal-500/55 bg-terminal-500 px-5 text-[12px] font-semibold tracking-[0.24em] text-flossa-black shadow-[0_0_34px_rgb(57_255_20_/_0.18)] transition duration-200 hover:bg-flossa-white focus:outline-none focus:ring-2 focus:ring-terminal-500 focus:ring-offset-2 focus:ring-offset-flossa-black active:scale-[0.98] disabled:cursor-default disabled:bg-terminal-500/80 disabled:hover:bg-terminal-500/80"
          >
            VERIFY
          </button>
        </form>

        <div className="mt-8 min-h-12 text-center">
          {status === 'error' ? (
            <p className="protocol-error-glitch text-[11px] tracking-[0.2em] text-red-300">
              ROOT ACCESS DENIED. PASSWORD INVALID.
            </p>
          ) : null}

          {status === 'validating' || status === 'verified' ? <ValidationSequence /> : null}

          {status === 'success' ? (
            <div className="success-pulse mx-auto inline-flex flex-col items-center gap-2 border border-terminal-500/55 bg-terminal-500/10 px-5 py-3 text-[12px] font-semibold tracking-[0.18em] text-terminal-500">
              <span className="h-2.5 w-2.5 bg-terminal-500 shadow-[0_0_18px_rgb(57_255_20_/_0.8)]" />
              <span>Master credentials accepted.</span>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  )
}

function Protocol06Screen({ onSuccess }: { onSuccess: () => void }) {
  const [answer, setAnswer] = useState('')
  const [status, setStatus] = useState<ProtocolStatus>('idle')
  const isLocked = status === 'validating' || status === 'verified' || status === 'success'

  function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    playSystemSound('click')

    if (answer.trim() !== '997') {
      playSystemSound('error')
      setStatus('error')
      return
    }

    completeValidation(setStatus, onSuccess)
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-flossa-black px-5 pb-7 pt-[calc(104px+env(safe-area-inset-top))] text-flossa-white">
      <div className="loading-grid absolute inset-0 opacity-30" />
      <div className="scanlines absolute inset-0 opacity-20" />

      <section className="relative z-10 w-full max-w-[390px] animate-fade-up font-code uppercase">
        <div className="mb-10">
          <p className="text-[11px] tracking-[0.34em] text-terminal-500/55">PROTOCOL 06</p>
          <h1 className="mt-5 text-3xl font-semibold leading-tight tracking-[0.16em] text-terminal-500">
            FINAL AUTHENTICATION
          </h1>
          <p className="terminal-type mt-5 max-w-max text-xs leading-6 tracking-[0.16em] text-flossa-white/56">
            Repository Guardian located.
          </p>
          <p className="mt-4 text-xs leading-6 tracking-[0.16em] text-flossa-white/56">
            Biometric verification required.
          </p>
          <p className="mt-4 text-xs leading-6 tracking-[0.16em] text-flossa-white/56">
            Use UV light<br />
            to inspect the owner's<br />
            left forearm.
          </p>
        </div>

        <form onSubmit={handleVerify} className="space-y-5">
          <label className="block">
            <span className="mb-3 block text-[10px] tracking-[0.24em] text-flossa-white/50">
              FINAL CODE
            </span>
            <input
              value={answer}
              onChange={(event) => {
                setAnswer(event.target.value)
                if (status === 'error') {
                  setStatus('idle')
                }
              }}
              disabled={isLocked}
              autoComplete="one-time-code"
              autoCorrect="off"
              spellCheck={false}
              inputMode="numeric"
              maxLength={3}
              placeholder="000"
              className="h-14 w-full border border-terminal-500/35 bg-flossa-black/80 px-4 text-center text-base font-semibold tracking-[0.38em] text-terminal-500 outline-none shadow-[inset_0_0_24px_rgb(57_255_20_/_0.08)] transition placeholder:text-terminal-500/20 focus:border-terminal-500 focus:ring-2 focus:ring-terminal-500/30 disabled:opacity-70"
            />
          </label>

          <button
            type="submit"
            disabled={isLocked}
            className="h-14 w-full border border-terminal-500/55 bg-terminal-500 px-5 text-[12px] font-semibold tracking-[0.24em] text-flossa-black shadow-[0_0_34px_rgb(57_255_20_/_0.18)] transition duration-200 hover:bg-flossa-white focus:outline-none focus:ring-2 focus:ring-terminal-500 focus:ring-offset-2 focus:ring-offset-flossa-black active:scale-[0.98] disabled:cursor-default disabled:bg-terminal-500/80 disabled:hover:bg-terminal-500/80"
          >
            VERIFY
          </button>
        </form>

        <div className="mt-8 min-h-12 text-center">
          {status === 'error' ? (
            <p className="protocol-error-glitch text-[11px] tracking-[0.2em] text-red-300">
              FINAL CODE REJECTED. RECOVERY INCOMPLETE.
            </p>
          ) : null}

          {status === 'validating' || status === 'verified' ? <ValidationSequence /> : null}

          {status === 'success' ? (
            <div className="success-pulse mx-auto inline-flex flex-col items-center gap-2 border border-terminal-500/55 bg-terminal-500/10 px-5 py-3 text-[12px] font-semibold tracking-[0.18em] text-terminal-500">
              <span className="h-2.5 w-2.5 bg-terminal-500 shadow-[0_0_18px_rgb(57_255_20_/_0.8)]" />
              <span>Guardian verified.</span>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  )
}

function SuccessScreen() {
  const confetti = useMemo(
    () =>
      Array.from({ length: 54 }, (_, index) => ({
        id: index,
        left: `${(index * 19) % 100}%`,
        delay: `${(index % 18) * 120}ms`,
        duration: `${2600 + (index % 8) * 220}ms`,
        color: index % 3 === 0 ? '#39ff14' : index % 3 === 1 ? '#ffffff' : '#1b1d1f',
      })),
    [],
  )

  function openFinalVideo() {
    playSystemSound('success')
    window.location.href = 'https://www.youtube.com/shorts/fOqPi6Vd8yM'
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-flossa-black px-5 pb-7 pt-[calc(104px+env(safe-area-inset-top))] text-center text-flossa-white">
      <div className="success-terminal-bg absolute inset-0" />
      <div className="scanlines absolute inset-0 opacity-25" />

      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {confetti.map((piece) => (
          <span
            key={piece.id}
            className="confetti-piece"
            style={{
              left: piece.left,
              animationDelay: piece.delay,
              animationDuration: piece.duration,
              backgroundColor: piece.color,
            }}
          />
        ))}
      </div>

      <section className="relative z-10 w-full max-w-[430px] font-code uppercase">
        <div className="success-terminal mx-auto border border-terminal-500/45 bg-flossa-black/78 px-5 py-8 shadow-[0_0_60px_rgb(57_255_20_/_0.18)]">
          <p className="mb-5 text-[11px] tracking-[0.34em] text-terminal-500/55 animate-fade-down">
            Repository restored.
          </p>

          <p className="terminal-type mx-auto max-w-max text-xs tracking-[0.18em] text-flossa-white/64">
            Running integrity check...
          </p>

          <div className="mt-6 text-terminal-500">
            <p className="text-[11px] tracking-[0.24em] text-flossa-white/48">Integrity:</p>
            <p className="mt-2 text-3xl font-semibold tracking-[0.22em]">100%</p>
          </div>

          <p className="mt-7 text-[12px] tracking-[0.16em] text-flossa-white/62">
            git restore vault404
          </p>

          <p className="mt-6 text-lg font-semibold tracking-[0.22em] text-terminal-500">SUCCESS</p>

          <h1 className="success-title mt-5 text-4xl font-semibold leading-tight tracking-[0.12em] text-terminal-500 sm:text-5xl">
            BUILD SUCCESSFUL
          </h1>

          <div className="mt-8 space-y-4">
            <p className="animate-fade-up text-sm tracking-[0.22em] text-flossa-white/78">
              Congratulations.
            </p>
            <p className="success-birthday text-lg font-semibold tracking-[0.22em] text-terminal-500">
              Happy Birthday
            </p>
            <p className="success-birthday text-2xl font-semibold tracking-[0.22em] text-terminal-500">
              PAWEŁ
            </p>
          </div>

          <div className="mx-auto mt-8 h-px w-4/5 bg-terminal-500/30 shadow-[0_0_20px_rgb(57_255_20_/_0.45)]" />

          <p className="mt-7 text-[10px] tracking-[0.24em] text-flossa-white/40">
            Twój kod do kłódki to 997
          </p>

          <button
            type="button"
            onClick={openFinalVideo}
            className="mt-6 h-14 w-full border border-terminal-500/55 bg-terminal-500 px-5 text-[12px] font-semibold uppercase tracking-[0.24em] text-flossa-black shadow-[0_0_34px_rgb(57_255_20_/_0.18)] transition duration-200 hover:bg-flossa-white focus:outline-none focus:ring-2 focus:ring-terminal-500 focus:ring-offset-2 focus:ring-offset-flossa-black active:scale-[0.98]"
          >
            kliknij
          </button>
        </div>
      </section>
    </main>
  )
}
