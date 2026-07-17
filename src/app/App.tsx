import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { registerSW } from 'virtual:pwa-register'
import secureMessageAudio from '../assets/secure-message.mp3'
import papalUnlockAudio from '../assets/papal-unlock.mp3'
import bugPurgeCompleteAudio from '../assets/bug-purge-complete.mp3'
import bugGunshotAudio from '../assets/bug-gunshot.mp3'
import dorotaHappyImage from '../assets/dorota-happy.png'
import dorotaSadImage from '../assets/dorota-sad.png'
import monsterRubyRedImage from '../assets/monster-ruby-red.png'
import ownerImage from '../assets/owner.png'
import ownerBallImage from '../assets/owner-ball.png'
import popeImage from '../assets/pope.png'

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
  | 'motion-calibration'
  | 'bug-purge-intro'
  | 'bug-purge'
  | 'protocol-05'
  | 'protocol-06'
  | 'cleaning-game'
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
const secureMessageStorageKey = 'git-recovery-secure-message-listened-v2'
const motionCalibrationStorageKey = 'git-recovery-motion-calibration-complete'
const bugPurgeStorageKey = 'git-recovery-bug-purge-complete'
const bugPurgeHpStorageKey = 'git-recovery-bug-purge-final-hp'
const appScreens: AppScreen[] = [
  'start',
  'loading',
  'transition',
  'secure-message',
  'protocol-01',
  'protocol-02',
  'protocol-03',
  'protocol-04',
  'motion-calibration',
  'bug-purge-intro',
  'bug-purge',
  'protocol-05',
  'protocol-06',
  'cleaning-game',
  'success',
]
let audioContext: AudioContext | null = null
let ambientNodes:
  | {
      oscillator: OscillatorNode
      modulator: OscillatorNode
      modulatorGain: GainNode
      filter: BiquadFilterNode
      gain: GainNode
    }
  | null = null

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

function normalizeAnswer(answer: string) {
  return answer.trim().toLocaleUpperCase('pl-PL')
}

function playLocalAudio(src: string, volume = 0.7) {
  try {
    const audio = new Audio(src)
    audio.volume = volume
    void audio.play()
  } catch {
    // Local audio is feedback only; gameplay must continue if the browser blocks it.
  }
}

function startAmbientSound() {
  try {
    if (ambientNodes) {
      void getAudioContext().resume()
      return
    }

    const context = getAudioContext()
    void context.resume()

    const oscillator = context.createOscillator()
    const modulator = context.createOscillator()
    const modulatorGain = context.createGain()
    const filter = context.createBiquadFilter()
    const gain = context.createGain()

    oscillator.type = 'sawtooth'
    oscillator.frequency.value = 48
    modulator.type = 'sine'
    modulator.frequency.value = 0.08
    modulatorGain.gain.value = 9
    filter.type = 'lowpass'
    filter.frequency.value = 180
    filter.Q.value = 4
    gain.gain.value = 0.012

    modulator.connect(modulatorGain)
    modulatorGain.connect(oscillator.frequency)
    oscillator.connect(filter)
    filter.connect(gain)
    gain.connect(context.destination)
    oscillator.start()
    modulator.start()

    ambientNodes = { oscillator, modulator, modulatorGain, filter, gain }
  } catch {
    // Background audio is optional and must never block the game flow.
  }
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
    startAmbientSound()
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
    void Promise.all([
      fetch(secureMessageAudio, { cache: 'force-cache' }),
      fetch(papalUnlockAudio, { cache: 'force-cache' }),
      fetch(bugPurgeCompleteAudio, { cache: 'force-cache' }),
      fetch(bugGunshotAudio, { cache: 'force-cache' }),
      fetch(popeImage, { cache: 'force-cache' }),
      fetch(ownerBallImage, { cache: 'force-cache' }),
      fetch(dorotaSadImage, { cache: 'force-cache' }),
      fetch(dorotaHappyImage, { cache: 'force-cache' }),
      fetch(monsterRubyRedImage, { cache: 'force-cache' }),
    ]).catch(() => undefined)
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
            continueWithLoading('motion-calibration')
          }}
        />
      )
    } else if (screen === 'motion-calibration') {
      content = (
        <MotionCalibrationScreen
          onSuccess={() => {
            window.localStorage.setItem(motionCalibrationStorageKey, 'true')
            continueWithLoading('bug-purge-intro')
          }}
        />
      )
    } else if (screen === 'bug-purge-intro') {
      content = <BugPurgeIntroScreen onBegin={() => continueWithLoading('bug-purge')} />
    } else if (screen === 'bug-purge') {
      content = (
        <BugPurgeScreen
          onComplete={() => {
            window.localStorage.setItem(bugPurgeStorageKey, 'true')
            window.localStorage.setItem(bugPurgeHpStorageKey, '10')
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
            continueWithLoading('cleaning-game')
          }}
        />
      )
    } else if (screen === 'cleaning-game') {
      content = <CleaningGameScreen onComplete={() => continueWithLoading('success')} />
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
    playSystemSound('beep')
  }, [activeMessageIndex])

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

  useEffect(() => {
    playSystemSound('beep')
  }, [])

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
  const unlockAudioRef = useRef<HTMLAudioElement | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [hasEnded, setHasEnded] = useState(() => {
    return window.localStorage.getItem(secureMessageStorageKey) === 'true'
  })
  const [papalTapCount, setPapalTapCount] = useState(0)
  const [isUnlockAudioPlaying, setIsUnlockAudioPlaying] = useState(false)
  const [isPapalUnlocked, setIsPapalUnlocked] = useState(false)
  const requiredPapalTaps = 10

  useEffect(() => {
    if (!isOpen) {
      return undefined
    }

    const audioElement = audioRef.current
    const unlockAudioElement = unlockAudioRef.current

    return () => {
      if (audioElement) {
        audioElement.pause()
        audioElement.currentTime = 0
      }

      if (unlockAudioElement) {
        unlockAudioElement.pause()
        unlockAudioElement.currentTime = 0
      }
    }
  }, [isOpen])

  async function openMessage() {
    playSystemSound('beep')
    setIsOpen(true)

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
    window.localStorage.setItem(secureMessageStorageKey, 'true')
    playSystemSound('success')
  }

  async function handlePapalTap() {
    if (!hasEnded || isPapalUnlocked || isUnlockAudioPlaying) {
      playSystemSound('error')
      return
    }

    const nextTapCount = Math.min(requiredPapalTaps, papalTapCount + 1)
    setPapalTapCount(nextTapCount)
    playSystemSound(nextTapCount === requiredPapalTaps ? 'success' : 'click')
    window.navigator.vibrate?.(nextTapCount === requiredPapalTaps ? [35, 25, 70] : 18)

    if (nextTapCount !== requiredPapalTaps) {
      return
    }

    if (!unlockAudioRef.current) {
      setIsPapalUnlocked(true)
      return
    }

    try {
      unlockAudioRef.current.currentTime = 0
      await unlockAudioRef.current.play()
      setIsUnlockAudioPlaying(true)
    } catch {
      setIsPapalUnlocked(true)
    }
  }

  function handleUnlockAudioEnded() {
    setIsUnlockAudioPlaying(false)
    setIsPapalUnlocked(true)
    playSystemSound('success')
  }

  function handleContinue() {
    if (!isPapalUnlocked) {
      playSystemSound('error')
      return
    }

    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
    }

    if (unlockAudioRef.current) {
      unlockAudioRef.current.pause()
      unlockAudioRef.current.currentTime = 0
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
      <audio
        ref={unlockAudioRef}
        src={papalUnlockAudio}
        preload="auto"
        onEnded={handleUnlockAudioEnded}
        onPause={() => setIsUnlockAudioPlaying(false)}
        onPlay={() => setIsUnlockAudioPlaying(true)}
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
          <div className="secure-message-open border border-terminal-500/35 bg-flossa-black/82 p-4 shadow-[0_0_46px_rgb(57_255_20_/_0.14)]">
            <div className="mb-5 text-center">
              <p className="secure-decrypt-glitch text-xl font-semibold tracking-[0.16em] text-terminal-500">
                MESSAGE DECRYPTED
              </p>
              <p className="terminal-type mx-auto mt-3 max-w-max text-[11px] tracking-[0.18em] text-flossa-white/60">
                Playing recovered transmission...
              </p>
            </div>

            <div className="relative mb-5 overflow-hidden border border-terminal-500/20 bg-flossa-black/60">
              <button
                type="button"
                onClick={handlePapalTap}
                disabled={!hasEnded || isPapalUnlocked || isUnlockAudioPlaying}
                className="group relative block w-full overflow-hidden bg-flossa-black text-left focus:outline-none focus:ring-2 focus:ring-terminal-500 disabled:cursor-not-allowed"
                aria-label="Tap the pope"
              >
                <img
                  src={popeImage}
                  alt="Pope in terminal code"
                  className="secure-pope-image aspect-[1/1] w-full object-cover"
                />
                <span className="absolute inset-0 bg-gradient-to-b from-flossa-black/5 via-transparent to-flossa-black/62" />
                <span className="absolute left-3 top-3 border border-terminal-500/35 bg-flossa-black/70 px-3 py-2 text-[10px] tracking-[0.2em] text-terminal-500/80">
                  {isPlaying ? 'TRANSMISSION ACTIVE' : 'TRANSMISSION STANDBY'}
                </span>
                {hasEnded ? (
                  <span className="absolute bottom-3 left-3 right-3 border border-terminal-500/30 bg-flossa-black/75 px-3 py-2 text-center text-[10px] tracking-[0.16em] text-terminal-500">
                    {isPapalUnlocked
                      ? 'PAPAL OVERRIDE ACCEPTED'
                      : isUnlockAudioPlaying
                        ? 'CONFIRMING OVERRIDE...'
                        : `TAP ${requiredPapalTaps - papalTapCount} MORE`}
                  </span>
                ) : null}
                {!isPapalUnlocked ? (
                  <span className="tap-tap-hint absolute right-4 top-16 border border-terminal-500/45 bg-flossa-black/86 px-4 py-3 text-[11px] font-semibold tracking-[0.2em] text-terminal-500 shadow-[0_0_22px_rgb(57_255_20_/_0.18)]">
                    {hasEnded ? 'TAP TAP' : 'LISTEN FIRST'}
                  </span>
                ) : null}
              </button>
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

            <div className="min-h-[76px] border border-terminal-500/20 bg-flossa-black/60 p-4 text-center text-[11px] leading-5 tracking-[0.14em] text-flossa-white/62">
              {!hasEnded ? (
                <p>Listen to the full transmission.</p>
              ) : isPapalUnlocked ? (
                <p className="text-terminal-500">Recovery gate unlocked.</p>
              ) : (
                <p className="animate-fade-up text-terminal-500">
                  Tap the pope 10 times to unlock recovery.
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={handleContinue}
              disabled={!isPapalUnlocked}
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

    if (normalizeAnswer(answer) !== 'V404-2718') {
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

    if (normalizeAnswer(answer) !== '4CE792') {
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

    if (normalizeAnswer(answer) !== '739') {
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
              <a
                href="tel:+48732128058"
                onClick={() => playSystemSound('click')}
                className="inline-flex items-center gap-2 text-terminal-500 underline decoration-terminal-500/40 underline-offset-4"
              >
                732 128 058
                <span className="text-[10px] tracking-[0.18em] text-flossa-white/52">kliknij</span>
              </a>
            </p>
            <p className="terminal-type mt-4 max-w-max text-xs leading-6 tracking-[0.12em] text-flossa-white/72">
              Ask exactly one question.
            </p>
            <p className="mt-3 text-xs leading-6 tracking-[0.12em] text-terminal-500/80">
              "Co to jest monsterek?"
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
  const tokenRef = useRef<HTMLFormElement | null>(null)
  const resultRef = useRef<HTMLDivElement | null>(null)
  const [answer, setAnswer] = useState('')
  const [status, setStatus] = useState<ProtocolStatus | 'token'>('idle')
  const [showMonsterBoost, setShowMonsterBoost] = useState(false)
  const isTokenVisible = status === 'token' || status === 'success'
  const isLocked = status === 'validating' || status === 'verified' || status === 'success'

  function triggerHapticError() {
    playSystemSound('error')
    setStatus('error')
  }

  function handleMonster() {
    playSystemSound('beep')
    setStatus('token')
    window.setTimeout(() => {
      tokenRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 80)
  }

  function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    playSystemSound('click')

    if (normalizeAnswer(answer) !== '672') {
      triggerHapticError()
      return
    }

    setStatus('validating')
    resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    window.setTimeout(() => {
      setStatus('verified')
      playSystemSound('beep')
    }, 620)
    window.setTimeout(() => {
      setShowMonsterBoost(true)
      playSystemSound('success')
    }, 920)
    window.setTimeout(() => {
      setShowMonsterBoost(false)
      setStatus('success')
    }, 2200)
    window.setTimeout(onSuccess, 2800)
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
              for 19 hours.
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
              Choose the only valid option that will get you back on your feet.
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
            &nbsp;&nbsp;MONSTER_NITRO();<br />
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
          <form ref={tokenRef} onSubmit={handleVerify} className="mt-5 space-y-5 animate-fade-up">
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

        <div ref={resultRef} className="mt-8 min-h-12 text-center">
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

      {showMonsterBoost ? (
        <div className="monster-boost-popup pointer-events-none fixed inset-x-4 top-1/2 z-[70] mx-auto flex max-w-[390px] -translate-y-1/2 items-center gap-5 border border-terminal-500/55 bg-flossa-black/95 p-5 font-code uppercase text-terminal-500 shadow-[0_0_54px_rgb(57_255_20_/_0.28)]">
          <img src={monsterRubyRedImage} alt="" className="h-40 w-24 object-contain drop-shadow-[0_0_22px_rgb(57_255_20_/_0.22)]" />
          <div>
            <p className="text-[10px] tracking-[0.24em] text-flossa-white/48">MONSTER BOOST</p>
            <p className="mt-2 text-2xl font-semibold tracking-[0.16em]">+30 ENERGY</p>
            <p className="mt-2 text-[10px] tracking-[0.18em] text-flossa-white/50">Recovery stamina restored.</p>
          </div>
        </div>
      ) : null}
    </main>
  )
}

type MotionMode = 'intro' | 'motion' | 'fallback' | 'complete'

type MotionVector = {
  x: number
  y: number
}

type MotionBody = {
  x: number
  y: number
  vx: number
  vy: number
  rotation: number
}

const motionBallSize = 50
const motionHoleSize = 94
const motionHolePosition = { x: 0.5, y: 0.92 }
const motionTiltStrength = 1380
const motionFallbackStrength = 1120
const motionFriction = 0.91
const motionMaxSpeed = 820
const motionDeadZone = 1.8
const motionObstacles = [
  { x: 0.2, y: 0.22, width: 0.16, height: 0.02 },
  { x: 0.64, y: 0.22, width: 0.16, height: 0.02 },
  { x: 0.04, y: 0.39, width: 0.2, height: 0.02 },
  { x: 0.48, y: 0.39, width: 0.16, height: 0.02 },
  { x: 0.76, y: 0.39, width: 0.16, height: 0.02 },
  { x: 0.22, y: 0.57, width: 0.18, height: 0.02 },
  { x: 0.62, y: 0.57, width: 0.2, height: 0.02 },
  { x: 0.36, y: 0.72, width: 0.24, height: 0.02 },
]
const motionMonsterPickups = [
  { x: 0.28, y: 0.19 },
  { x: 0.72, y: 0.19 },
  { x: 0.14, y: 0.36 },
  { x: 0.56, y: 0.36 },
  { x: 0.86, y: 0.36 },
  { x: 0.31, y: 0.54 },
  { x: 0.72, y: 0.54 },
  { x: 0.48, y: 0.69 },
]

function MotionCalibrationScreen({ onSuccess }: { onSuccess: () => void }) {
  const boardRef = useRef<HTMLDivElement | null>(null)
  const bodyRef = useRef<MotionBody>({ x: 0, y: 0, vx: 0, vy: 0, rotation: 0 })
  const tiltRef = useRef<MotionVector>({ x: 0, y: 0 })
  const fallbackVectorRef = useRef<MotionVector>({ x: 0, y: 0 })
  const collectedPickupsRef = useRef<number[]>([])
  const lastFrameRef = useRef<number | null>(null)
  const hasOrientationEventRef = useRef(false)
  const successTimerRef = useRef<number | null>(null)
  const [mode, setMode] = useState<MotionMode>(() =>
    window.localStorage.getItem(motionCalibrationStorageKey) === 'true' ? 'complete' : 'intro',
  )
  const [ball, setBall] = useState<MotionBody>({ x: 0, y: 0, vx: 0, vy: 0, rotation: 0 })
  const [sensorMessage, setSensorMessage] = useState('')
  const [showContinue, setShowContinue] = useState(
    () => window.localStorage.getItem(motionCalibrationStorageKey) === 'true',
  )
  const [collectedPickups, setCollectedPickups] = useState<number[]>([])
  const [showTiltHint, setShowTiltHint] = useState(true)
  const isPlaying = mode === 'motion' || mode === 'fallback'
  const healthPoints = collectedPickups.length * 5

  useEffect(() => {
    collectedPickupsRef.current = collectedPickups
  }, [collectedPickups])

  function getBoardMetrics() {
    const board = boardRef.current

    if (!board) {
      return null
    }

    const rect = board.getBoundingClientRect()
    return {
      width: rect.width,
      height: rect.height,
      rect,
      radius: motionBallSize / 2,
      hole: {
        x: rect.width * motionHolePosition.x,
        y: rect.height * motionHolePosition.y,
        radius: motionHoleSize / 2,
      },
    }
  }

  function resetBall() {
    const metrics = getBoardMetrics()

    if (!metrics) {
      return
    }

    const nextBody = {
      x: metrics.width * 0.5,
      y: metrics.height * 0.16,
      vx: 0,
      vy: 0,
      rotation: 0,
    }

    bodyRef.current = nextBody
    setBall(nextBody)
  }

  async function beginCalibration() {
    playSystemSound('click')
    setSensorMessage('')
    setShowContinue(false)
    setShowTiltHint(true)
    window.localStorage.removeItem(motionCalibrationStorageKey)
    setCollectedPickups([])
    collectedPickupsRef.current = []

    if (typeof DeviceOrientationEvent === 'undefined') {
      setSensorMessage('MOTION SENSOR UNAVAILABLE')
      setMode('fallback')
      return
    }

    const orientationEvent = DeviceOrientationEvent as typeof DeviceOrientationEvent & {
      requestPermission?: () => Promise<PermissionState>
    }

    if (typeof orientationEvent.requestPermission === 'function') {
      try {
        const permission = await orientationEvent.requestPermission()

        if (permission !== 'granted') {
          setSensorMessage('MOTION SENSOR UNAVAILABLE')
          setMode('fallback')
          return
        }
      } catch {
        setSensorMessage('MOTION SENSOR UNAVAILABLE')
        setMode('fallback')
        return
      }
    }

    hasOrientationEventRef.current = false
    setMode('motion')
    window.setTimeout(() => {
      if (!hasOrientationEventRef.current && mode !== 'complete') {
        setSensorMessage('MOTION SENSOR UNAVAILABLE')
        setMode('fallback')
      }
    }, 1400)
  }

  function completeCalibration() {
    if (mode === 'complete') {
      return
    }

    playSystemSound('success')
    window.navigator.vibrate?.([50, 30, 90])
    window.localStorage.setItem(motionCalibrationStorageKey, 'true')
    setMode('complete')

    if (successTimerRef.current) {
      window.clearTimeout(successTimerRef.current)
    }

    successTimerRef.current = window.setTimeout(() => setShowContinue(true), 450)
  }

  function moveBody(deltaSeconds: number) {
    const metrics = getBoardMetrics()

    if (!metrics) {
      return
    }

    const body = bodyRef.current
    const control = mode === 'motion' ? tiltRef.current : fallbackVectorRef.current
    const strength = mode === 'motion' ? motionTiltStrength : motionFallbackStrength
    const obstacles = motionObstacles.map((obstacle) => ({
      left: obstacle.x * metrics.width,
      top: obstacle.y * metrics.height,
      right: (obstacle.x + obstacle.width) * metrics.width,
      bottom: (obstacle.y + obstacle.height) * metrics.height,
    }))

    body.vx += control.x * strength * deltaSeconds
    body.vy += control.y * strength * deltaSeconds
    body.vx *= Math.pow(motionFriction, deltaSeconds * 60)
    body.vy *= Math.pow(motionFriction, deltaSeconds * 60)

    const speed = Math.hypot(body.vx, body.vy)
    if (speed > motionMaxSpeed) {
      const scale = motionMaxSpeed / speed
      body.vx *= scale
      body.vy *= scale
    }

    body.x += body.vx * deltaSeconds
    body.y += body.vy * deltaSeconds
    body.rotation += (body.vx * deltaSeconds) / 10

    const pickupHits: number[] = []
    motionMonsterPickups.forEach((pickup, index) => {
      if (collectedPickupsRef.current.includes(index)) {
        return
      }

      const pickupX = pickup.x * metrics.width
      const pickupY = pickup.y * metrics.height

      if (Math.hypot(body.x - pickupX, body.y - pickupY) < metrics.radius + 20) {
        pickupHits.push(index)
      }
    })

    if (pickupHits.length > 0) {
      setCollectedPickups((currentPickups) => [
        ...currentPickups,
        ...pickupHits.filter((pickupIndex) => !currentPickups.includes(pickupIndex)),
      ])
      playSystemSound('beep')
      window.navigator.vibrate?.(18)
    }

    body.x = Math.min(metrics.width - metrics.radius, Math.max(metrics.radius, body.x))
    body.y = Math.min(metrics.height - metrics.radius, Math.max(metrics.radius, body.y))

    for (const obstacle of obstacles) {
      const closestX = Math.min(obstacle.right, Math.max(obstacle.left, body.x))
      const closestY = Math.min(obstacle.bottom, Math.max(obstacle.top, body.y))
      const dx = body.x - closestX
      const dy = body.y - closestY
      const distance = Math.hypot(dx, dy)

      if (distance > metrics.radius || distance === 0) {
        continue
      }

      const push = metrics.radius - distance
      const nx = dx / distance
      const ny = dy / distance
      body.x += nx * push
      body.y += ny * push

      if (Math.abs(nx) > Math.abs(ny)) {
        body.vx *= -0.34
      } else {
        body.vy *= -0.34
      }
    }

    const holeDistance = Math.hypot(body.x - metrics.hole.x, body.y - metrics.hole.y)
    const isInsideHole = holeDistance < metrics.hole.radius + metrics.radius

    if (isInsideHole) {
      body.x += (metrics.hole.x - body.x) * 0.24
      body.y += (metrics.hole.y - body.y) * 0.24
      body.vx *= 0.4
      body.vy *= 0.4
      completeCalibration()
    }

    bodyRef.current = { ...body }
    setBall({ ...body })
  }

  useEffect(() => {
    if (!isPlaying) {
      lastFrameRef.current = null
      return undefined
    }

    let frame = 0

    function tick(timestamp: number) {
      const lastFrame = lastFrameRef.current ?? timestamp
      const deltaSeconds = Math.min(0.033, Math.max(0, (timestamp - lastFrame) / 1000))
      lastFrameRef.current = timestamp

      moveBody(deltaSeconds)
      frame = window.requestAnimationFrame(tick)
    }

    frame = window.requestAnimationFrame(tick)

    return () => window.cancelAnimationFrame(frame)
    // moveBody reads live refs and current mode; restarting this loop on every render would jitter physics.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, mode])

  useEffect(() => {
    if (!isPlaying || !showTiltHint) {
      return undefined
    }

    const timer = window.setTimeout(() => setShowTiltHint(false), 5000)

    return () => window.clearTimeout(timer)
  }, [isPlaying, showTiltHint])

  useEffect(() => {
    if (!isPlaying) {
      return undefined
    }

    const frame = window.requestAnimationFrame(resetBall)

    return () => window.cancelAnimationFrame(frame)
    // resetBall must run only when the board first appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying])

  useEffect(() => {
    if (mode !== 'motion') {
      return undefined
    }

    function handleOrientation(event: DeviceOrientationEvent) {
      hasOrientationEventRef.current = true
      const gamma = event.gamma ?? 0
      const beta = event.beta ?? 0
      const rawX = Math.abs(gamma) < motionDeadZone ? 0 : gamma / 24
      const rawY = Math.abs(beta) < motionDeadZone ? 0 : (beta - 35) / 28

      tiltRef.current = {
        x: tiltRef.current.x * 0.82 + Math.max(-1, Math.min(1, rawX)) * 0.18,
        y: tiltRef.current.y * 0.82 + Math.max(-1, Math.min(1, rawY)) * 0.18,
      }
    }

    window.addEventListener('deviceorientation', handleOrientation)

    return () => window.removeEventListener('deviceorientation', handleOrientation)
  }, [mode])

  useEffect(() => {
    function handleVisibilityChange() {
      lastFrameRef.current = null
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)

      if (successTimerRef.current) {
        window.clearTimeout(successTimerRef.current)
      }
    }
  }, [])

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (mode !== 'fallback' || event.buttons !== 1) {
      return
    }

    const metrics = getBoardMetrics()

    if (!metrics) {
      return
    }

    const nextBody = {
      ...bodyRef.current,
      x: Math.min(
        metrics.width - metrics.radius,
        Math.max(metrics.radius, event.clientX - metrics.rect.left),
      ),
      y: Math.min(
        metrics.height - metrics.radius,
        Math.max(metrics.radius, event.clientY - metrics.rect.top),
      ),
      vx: 0,
      vy: 0,
    }

    bodyRef.current = nextBody
    setBall(nextBody)
    moveBody(0)
  }

  function setFallbackDirection(x: number, y: number) {
    fallbackVectorRef.current = { x, y }
  }

  const ballScale = mode === 'complete' ? 0.18 : 1

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-flossa-black px-4 pb-6 pt-[calc(104px+env(safe-area-inset-top))] text-flossa-white">
      <div className="loading-grid absolute inset-0 opacity-30" />
      <div className="scanlines absolute inset-0 opacity-20" />

      <section className="relative z-10 flex min-h-[calc(100dvh-132px)] w-full max-w-[430px] flex-col font-code uppercase">
        {mode === 'intro' ? (
          <div className="m-auto w-full animate-fade-up border border-terminal-500/35 bg-flossa-black/82 p-5 text-center shadow-[0_0_46px_rgb(57_255_20_/_0.14)]">
            <p className="text-[11px] tracking-[0.34em] text-terminal-500/55">PROTOCOL 04B</p>
            <h1 className="mt-5 text-3xl font-semibold leading-tight tracking-[0.16em] text-terminal-500">
              Motion Calibration
            </h1>
            <p className="mt-6 text-xs leading-6 tracking-[0.14em] text-flossa-white/62">
              Repository core displaced.
            </p>
            <p className="mt-5 text-xs leading-6 tracking-[0.14em] text-flossa-white/62">
              Tilt the device<br />
              to restore alignment.
            </p>
            <button
              type="button"
              onClick={beginCalibration}
              className="mt-8 h-14 w-full border border-terminal-500/55 bg-terminal-500 px-5 text-[12px] font-semibold tracking-[0.2em] text-flossa-black shadow-[0_0_34px_rgb(57_255_20_/_0.18)] transition duration-200 hover:bg-flossa-white focus:outline-none focus:ring-2 focus:ring-terminal-500 focus:ring-offset-2 focus:ring-offset-flossa-black active:scale-[0.98]"
            >
              BEGIN CALIBRATION
            </button>
          </div>
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between text-[10px] tracking-[0.2em] text-flossa-white/52">
              <span>PROTOCOL 04B</span>
              <span>HEALTH +{healthPoints}</span>
            </div>
            <p className="mb-3 text-center text-[10px] tracking-[0.16em] text-terminal-500/75">
              Collect as many Monsters as possible before entering the core.
            </p>

            <div
              ref={boardRef}
              onPointerDown={handlePointerMove}
              onPointerMove={handlePointerMove}
              className="motion-board relative min-h-[64dvh] flex-1 overflow-hidden border border-terminal-500/30 bg-flossa-black/78 shadow-[0_0_46px_rgb(57_255_20_/_0.12)]"
            >
              <div
                className="motion-hole absolute -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{
                  height: `${motionHoleSize}px`,
                  left: `${motionHolePosition.x * 100}%`,
                  top: `${motionHolePosition.y * 100}%`,
                  width: `${motionHoleSize}px`,
                }}
              />
              {mode !== 'complete' && showTiltHint ? (
                <div className="tilt-hint pointer-events-none absolute left-1/2 top-5 z-20 -translate-x-1/2 border border-terminal-500/35 bg-flossa-black/80 px-4 py-3 text-center shadow-[0_0_22px_rgb(57_255_20_/_0.14)]">
                  <div className="tilt-phone mx-auto h-10 w-6 border border-terminal-500/45 bg-flossa-black/60 shadow-[0_0_18px_rgb(57_255_20_/_0.18)]" />
                  <p className="mt-2 whitespace-nowrap text-[9px] tracking-[0.2em] text-terminal-500/80">
                    TILT SIDE TO SIDE
                  </p>
                </div>
              ) : null}

              {motionObstacles.map((obstacle, index) => (
                <div
                  key={index}
                  className="motion-obstacle absolute"
                  style={{
                    left: `${obstacle.x * 100}%`,
                    top: `${obstacle.y * 100}%`,
                    width: `${obstacle.width * 100}%`,
                    height: `${obstacle.height * 100}%`,
                  }}
                />
              ))}

              {motionMonsterPickups.map((pickup, index) =>
                collectedPickups.includes(index) ? null : (
                  <img
                    key={index}
                    src={monsterRubyRedImage}
                    alt=""
                    className="motion-pickup absolute z-10 h-9 w-6 -translate-x-1/2 -translate-y-1/2 object-contain"
                    style={{
                      left: `${pickup.x * 100}%`,
                      top: `${pickup.y * 100}%`,
                    }}
                  />
                ),
              )}

              <img
                src={ownerBallImage}
                alt="Repository core ball"
                draggable={false}
                className={`motion-ball absolute select-none rounded-full object-cover ${
                  mode === 'complete' ? 'motion-ball-complete' : ''
                }`}
                style={{
                  height: `${motionBallSize}px`,
                  left: `${ball.x - motionBallSize / 2}px`,
                  top: `${ball.y - motionBallSize / 2}px`,
                  transform: `rotate(${ball.rotation}deg) scale(${ballScale})`,
                  width: `${motionBallSize}px`,
                }}
              />
            </div>

            <div className="mt-4 min-h-[112px] text-center">
              {mode === 'fallback' ? (
                <div className="animate-fade-up border border-terminal-500/25 bg-flossa-black/70 p-3 text-[11px] leading-5 tracking-[0.14em] text-flossa-white/62">
                  <p className="text-red-300">{sensorMessage || 'MOTION SENSOR UNAVAILABLE'}</p>
                  <p className="mt-2 text-terminal-500">Fallback controls initialized.</p>
                </div>
              ) : null}

              {mode === 'complete' ? (
                <div className="success-pulse border border-terminal-500/45 bg-terminal-500/10 p-4 text-[12px] leading-6 tracking-[0.16em] text-terminal-500">
                  <p>CORE ALIGNED</p>
                  <p className="text-flossa-white/64">Motion calibration complete.</p>
                </div>
              ) : null}

              {mode === 'fallback' && !showContinue ? (
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <span />
                  <button
                    type="button"
                    onPointerDown={() => setFallbackDirection(0, -1)}
                    onPointerUp={() => setFallbackDirection(0, 0)}
                    onPointerLeave={() => setFallbackDirection(0, 0)}
                    className="h-12 border border-terminal-500/35 text-terminal-500"
                  >
                    UP
                  </button>
                  <span />
                  <button
                    type="button"
                    onPointerDown={() => setFallbackDirection(-1, 0)}
                    onPointerUp={() => setFallbackDirection(0, 0)}
                    onPointerLeave={() => setFallbackDirection(0, 0)}
                    className="h-12 border border-terminal-500/35 text-terminal-500"
                  >
                    LEFT
                  </button>
                  <button
                    type="button"
                    onPointerDown={() => setFallbackDirection(0, 1)}
                    onPointerUp={() => setFallbackDirection(0, 0)}
                    onPointerLeave={() => setFallbackDirection(0, 0)}
                    className="h-12 border border-terminal-500/35 text-terminal-500"
                  >
                    DOWN
                  </button>
                  <button
                    type="button"
                    onPointerDown={() => setFallbackDirection(1, 0)}
                    onPointerUp={() => setFallbackDirection(0, 0)}
                    onPointerLeave={() => setFallbackDirection(0, 0)}
                    className="h-12 border border-terminal-500/35 text-terminal-500"
                  >
                    RIGHT
                  </button>
                </div>
              ) : null}

              {showContinue ? (
                <button
                  type="button"
                  onClick={() => {
                    playSystemSound('click')
                    onSuccess()
                  }}
                  className="mt-4 h-14 w-full border border-terminal-500/55 bg-terminal-500 px-5 text-[12px] font-semibold tracking-[0.2em] text-flossa-black shadow-[0_0_34px_rgb(57_255_20_/_0.18)] transition duration-200 hover:bg-flossa-white focus:outline-none focus:ring-2 focus:ring-terminal-500 focus:ring-offset-2 focus:ring-offset-flossa-black active:scale-[0.98]"
                >
                  CONTINUE RECOVERY
                </button>
              ) : null}
            </div>
          </>
        )}
      </section>
    </main>
  )
}

type BugTarget = {
  id: number
  x: number
  y: number
  vx: number
  vy: number
  alive: boolean
  shotCooldown: number
}

type BugProjectile = {
  id: number
  x: number
  y: number
  vy: number
}

type HitBurst = {
  id: number
  x: number
  y: number
}

const bugPurgeBugCount = 7
const bugPurgeDamage = 10
const bugPurgeMinHp = 10
const bugPurgeTargetHits = 9
const bugPurgeBugSpeed = 165
const bugPurgeShotInterval = 0.82
const bugPurgeInitialBugs: BugTarget[] = Array.from({ length: bugPurgeBugCount }, (_, index) => ({
  id: index,
  x: 14 + ((index * 27) % 72),
  y: 24 + ((index * 13) % 34),
  vx: (index % 2 === 0 ? 1 : -1) * (bugPurgeBugSpeed + index * 7),
  vy: (index % 3 === 0 ? 1 : -1) * (bugPurgeBugSpeed * 0.52 + index * 4),
  alive: true,
  shotCooldown: 0.7 + index * 0.22,
}))

function BugPurgeIntroScreen({ onBegin }: { onBegin: () => void }) {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-flossa-black px-5 pb-7 pt-[calc(104px+env(safe-area-inset-top))] text-center text-flossa-white">
      <div className="loading-grid absolute inset-0 opacity-30" />
      <div className="scanlines absolute inset-0 opacity-20" />

      <section className="relative z-10 w-full max-w-[390px] animate-fade-up border border-terminal-500/35 bg-flossa-black/82 p-5 font-code uppercase shadow-[0_0_46px_rgb(57_255_20_/_0.14)]">
        <p className="text-[11px] tracking-[0.34em] text-terminal-500/55">CORE ACCESS GRANTED</p>
        <h1 className="mt-5 text-2xl font-semibold leading-tight tracking-[0.16em] text-terminal-500">
          Monsters transferred successfully.
        </h1>
        <div className="mt-8 border border-red-300/25 bg-flossa-black/70 p-4">
          <p className="protocol-error-glitch text-[12px] tracking-[0.22em] text-red-300">WARNING</p>
          <p className="mt-4 text-xs leading-6 tracking-[0.14em] text-flossa-white/62">
            Core entry exposed<br />
            multiple hostile processes.
          </p>
          <p className="mt-4 text-xs leading-6 tracking-[0.14em] text-terminal-500/80">
            Active bugs detected.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            playSystemSound('click')
            onBegin()
          }}
          className="mt-8 h-14 w-full border border-terminal-500/55 bg-terminal-500 px-5 text-[12px] font-semibold tracking-[0.2em] text-flossa-black shadow-[0_0_34px_rgb(57_255_20_/_0.18)] transition duration-200 hover:bg-flossa-white focus:outline-none focus:ring-2 focus:ring-terminal-500 focus:ring-offset-2 focus:ring-offset-flossa-black active:scale-[0.98]"
        >
          INITIALIZE BUG PURGE
        </button>
      </section>
    </main>
  )
}

function BugPurgeScreen({ onComplete }: { onComplete: () => void }) {
  const wasCompleted = window.localStorage.getItem(bugPurgeStorageKey) === 'true'
  const initialBugs = bugPurgeInitialBugs.map((bug) => ({ ...bug, alive: wasCompleted ? false : bug.alive }))
  const arenaRef = useRef<HTMLDivElement | null>(null)
  const bugsRef = useRef<BugTarget[]>(initialBugs)
  const projectilesRef = useRef<BugProjectile[]>([])
  const lastFrameRef = useRef<number | null>(null)
  const residualTimerRef = useRef<number | null>(null)
  const [bugs, setBugs] = useState<BugTarget[]>(initialBugs)
  const [projectiles, setProjectiles] = useState<BugProjectile[]>([])
  const [bursts, setBursts] = useState<HitBurst[]>([])
  const [hp, setHp] = useState(wasCompleted ? bugPurgeMinHp : 100)
  const [damageHits, setDamageHits] = useState(wasCompleted ? bugPurgeTargetHits : 0)
  const [shotPulse, setShotPulse] = useState(0)
  const [damageFlash, setDamageFlash] = useState(false)
  const [isResidualAttack, setIsResidualAttack] = useState(false)
  const [isComplete, setIsComplete] = useState(wasCompleted)
  const eliminated = bugs.filter((bug) => !bug.alive).length
  const hpColor = hp <= 30 ? 'bg-red-400' : hp <= 60 ? 'bg-yellow-300' : 'bg-terminal-500'

  function applyPlayerDamage() {
    setDamageHits((currentHits) => {
      if (currentHits >= bugPurgeTargetHits) {
        return currentHits
      }

      const nextHits = currentHits + 1
      setHp(Math.max(bugPurgeMinHp, 100 - nextHits * bugPurgeDamage))
      setDamageFlash(true)
      window.setTimeout(() => setDamageFlash(false), 140)
      window.navigator.vibrate?.(22)
      playSystemSound('error')
      return nextHits
    })
  }

  const maybeComplete = useCallback((nextEliminated = eliminated, nextDamageHits = damageHits) => {
    if (nextEliminated < bugPurgeBugCount || nextDamageHits < bugPurgeTargetHits || isComplete) {
      return
    }

    setHp(bugPurgeMinHp)
    setIsComplete(true)
    setIsResidualAttack(false)
    if (residualTimerRef.current) {
      window.clearInterval(residualTimerRef.current)
      residualTimerRef.current = null
    }
    window.localStorage.setItem(bugPurgeStorageKey, 'true')
    window.localStorage.setItem(bugPurgeHpStorageKey, bugPurgeMinHp.toString())
    playSystemSound('success')
    playLocalAudio(bugPurgeCompleteAudio, 0.9)
  }, [damageHits, eliminated, isComplete])

  function startResidualAttack() {
    if (isResidualAttack || damageHits >= bugPurgeTargetHits) {
      return
    }

    setIsResidualAttack(true)

    residualTimerRef.current = window.setInterval(() => {
      setDamageHits((currentHits) => {
        if (currentHits >= bugPurgeTargetHits) {
          if (residualTimerRef.current) {
            window.clearInterval(residualTimerRef.current)
            residualTimerRef.current = null
          }
          setHp(bugPurgeMinHp)
          setIsResidualAttack(false)
          maybeComplete(bugPurgeBugCount, bugPurgeTargetHits)
          return currentHits
        }

        const nextHits = currentHits + 1
        setHp(Math.max(bugPurgeMinHp, 100 - nextHits * bugPurgeDamage))
        setDamageFlash(true)
        window.setTimeout(() => setDamageFlash(false), 120)
        window.navigator.vibrate?.(20)
        return nextHits
      })
    }, 420)
  }

  function shootAt(clientX: number, clientY: number) {
    if (isComplete) {
      return
    }

    startAmbientSound()
    playLocalAudio(bugGunshotAudio, 0.62)
    window.navigator.vibrate?.(18)
    setShotPulse((pulse) => pulse + 1)

    const arena = arenaRef.current?.getBoundingClientRect()
    if (!arena) {
      return
    }

    const x = ((clientX - arena.left) / arena.width) * 100
    const y = ((clientY - arena.top) / arena.height) * 100
    let hitBugId: number | null = null

    for (const bug of bugsRef.current) {
      if (!bug.alive) {
        continue
      }

      if (Math.hypot(bug.x - x, bug.y - y) <= 6.4) {
        hitBugId = bug.id
        break
      }
    }

    if (hitBugId === null) {
      return
    }

    const nextBugs = bugsRef.current.map((bug) =>
      bug.id === hitBugId ? { ...bug, alive: false } : bug,
    )
    const hitBug = bugsRef.current.find((bug) => bug.id === hitBugId)
    bugsRef.current = nextBugs
    setBugs(nextBugs)

    if (hitBug) {
      const burstId = Date.now()
      setBursts((currentBursts) => [...currentBursts, { id: burstId, x: hitBug.x, y: hitBug.y }])
      window.setTimeout(
        () => setBursts((currentBursts) => currentBursts.filter((burst) => burst.id !== burstId)),
        420,
      )
    }

    const nextEliminated = nextBugs.filter((bug) => !bug.alive).length

    if (nextEliminated === bugPurgeBugCount && damageHits < bugPurgeTargetHits) {
      startResidualAttack()
    } else {
      maybeComplete(nextEliminated, damageHits)
    }
  }

  useEffect(() => {
    let frame = 0

    function tick(timestamp: number) {
      const lastFrame = lastFrameRef.current ?? timestamp
      const deltaSeconds = Math.min(0.033, Math.max(0, (timestamp - lastFrame) / 1000))
      lastFrameRef.current = timestamp

      if (!isComplete) {
        const nextBugs = bugsRef.current.map((bug) => {
          if (!bug.alive) {
            return bug
          }

          let nextX = bug.x + (bug.vx * deltaSeconds) / 3.8
          let nextY = bug.y + (bug.vy * deltaSeconds) / 3.8
          let nextVx = bug.vx
          let nextVy = bug.vy
          let nextCooldown = bug.shotCooldown - deltaSeconds

          if (nextX < 8 || nextX > 92) {
            nextVx *= -1
            nextX = Math.min(92, Math.max(8, nextX))
          }

          if (nextY < 20 || nextY > 66) {
            nextVy *= -1
            nextY = Math.min(66, Math.max(20, nextY))
          }

          if (nextCooldown <= 0) {
            projectilesRef.current = [
              ...projectilesRef.current,
              { id: Date.now() + bug.id, x: nextX, y: nextY + 4, vy: 38 + bug.id * 3 },
            ]
            nextCooldown = bugPurgeShotInterval + (bug.id % 3) * 0.34
          }

          return { ...bug, x: nextX, y: nextY, vx: nextVx, vy: nextVy, shotCooldown: nextCooldown }
        })

        bugsRef.current = nextBugs
        setBugs(nextBugs)

        const nextProjectiles: BugProjectile[] = []
        projectilesRef.current.forEach((projectile) => {
          const nextProjectile = { ...projectile, y: projectile.y + projectile.vy * deltaSeconds }

          if (nextProjectile.y >= 88) {
            applyPlayerDamage()
            return
          }

          nextProjectiles.push(nextProjectile)
        })
        projectilesRef.current = nextProjectiles
        setProjectiles(nextProjectiles)
      }

      frame = window.requestAnimationFrame(tick)
    }

    frame = window.requestAnimationFrame(tick)

    return () => window.cancelAnimationFrame(frame)
  }, [isComplete])

  useEffect(() => {
    maybeComplete(eliminated, damageHits)
  }, [eliminated, damageHits, maybeComplete])

  useEffect(
    () => () => {
      if (residualTimerRef.current) {
        window.clearInterval(residualTimerRef.current)
      }
    },
    [],
  )

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-flossa-black px-4 pb-5 pt-[calc(104px+env(safe-area-inset-top))] text-flossa-white">
      <div className="loading-grid absolute inset-0 opacity-30" />
      <div className="scanlines absolute inset-0 opacity-20" />
      {damageFlash ? <div className="bug-damage-flash pointer-events-none fixed inset-0 z-[65]" /> : null}

      <section className="relative z-10 flex min-h-[calc(100dvh-132px)] w-full max-w-[430px] flex-col font-code uppercase">
        <div className="mb-3">
          <div className="flex items-center justify-between text-[10px] tracking-[0.22em] text-flossa-white/52">
            <span>PROTOCOL 04C</span>
            <span>BUG PURGE</span>
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-[0.16em] text-terminal-500">BUG PURGE</h1>
          <p className="mt-2 text-[10px] leading-4 tracking-[0.12em] text-flossa-white/56">
            Seven hostile bugs detected inside the core. Eliminate all targets before system integrity fails.
          </p>
          <div className="mt-3 flex items-center justify-between text-[10px] tracking-[0.16em] text-flossa-white/62">
            <span>SYSTEM INTEGRITY: {hp} HP</span>
            <span>BUGS ELIMINATED: {eliminated} / {bugPurgeBugCount}</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden border border-terminal-500/25 bg-flossa-graphite/70">
            <div className={`h-full transition-[width] duration-200 ${hpColor}`} style={{ width: `${hp}%` }} />
          </div>
        </div>

        <div
          ref={arenaRef}
          onPointerDown={(event) => shootAt(event.clientX, event.clientY)}
          className="bug-arena relative flex-1 overflow-hidden border border-terminal-500/30 bg-flossa-black/78"
        >
          {bugs.map((bug) =>
            bug.alive ? (
              <button
                key={bug.id}
                type="button"
                aria-label="hostile bug"
                className="bug-target absolute"
                style={{ left: `${bug.x}%`, top: `${bug.y}%` }}
              >
                <span>BUG</span>
              </button>
            ) : null,
          )}

          {projectiles.map((projectile) => (
            <span
              key={projectile.id}
              className="bug-projectile absolute"
              style={{ left: `${projectile.x}%`, top: `${projectile.y}%` }}
            >
              ERR
            </span>
          ))}

          {bursts.map((burst) => (
            <span
              key={burst.id}
              className="bug-hit-burst absolute"
              style={{ left: `${burst.x}%`, top: `${burst.y}%` }}
            />
          ))}

          {isResidualAttack ? (
            <div className="absolute inset-x-4 top-1/2 -translate-y-1/2 border border-red-300/35 bg-flossa-black/86 p-3 text-center text-[11px] tracking-[0.18em] text-red-300">
              RESIDUAL ATTACK DETECTED
            </div>
          ) : null}

          {isComplete ? (
            <div className="absolute inset-4 flex items-center justify-center bg-flossa-black/82 text-center">
              <div className="success-pulse border border-terminal-500/45 bg-terminal-500/10 p-5 text-[12px] leading-6 tracking-[0.16em] text-terminal-500">
                <p>BUG PURGE COMPLETE</p>
                <p>NO ACTIVE BUGS DETECTED</p>
                <p>SYSTEM INTEGRITY CRITICAL: 10 HP</p>
                <p>CORE SECURED</p>
                <button
                  type="button"
                  onClick={() => {
                    playSystemSound('click')
                    onComplete()
                  }}
                  className="mt-5 h-12 w-full border border-terminal-500/55 bg-terminal-500 px-4 text-[11px] font-semibold tracking-[0.18em] text-flossa-black"
                >
                  CONTINUE RECOVERY
                </button>
              </div>
            </div>
          ) : null}

          <div className={`bug-weapon ${shotPulse ? 'bug-weapon-recoil' : ''}`} key={shotPulse}>
            <div className="bug-muzzle-flash" />
            <div className="bug-gun-barrel" />
            <div className="bug-gun-body" />
          </div>
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

    if (normalizeAnswer(answer) !== 'ROOT_ACCESS_CHRABĄSZCZ') {
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
          <p className="mt-5 text-[11px] leading-6 tracking-[0.16em] text-terminal-500/75">
            An envelope marked<br />
            ROOT ACCESS<br />
            is waiting for you.
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

    if (normalizeAnswer(answer) !== '997') {
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
            Someone at this party<br />
            has the final code.
          </p>
          <p className="mt-4 text-xs leading-6 tracking-[0.16em] text-terminal-500/75">
            The code is located<br />
            on the left forearm<br />
            of the Repository Guardian.
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

function playCleaningSuccessSound() {
  try {
    const context = getAudioContext()
    void context.resume()
    startAmbientSound()
    const now = context.currentTime

    playTone(660, now, 0.08, 0.045)
    playTone(880, now + 0.09, 0.08, 0.045)
    playTone(1320, now + 0.19, 0.14, 0.05)
  } catch {
    // Optional sound cue; the visual success state is enough.
  }
}

function CleaningGameScreen({ onComplete }: { onComplete: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const cleaningResultRef = useRef<HTMLDivElement | null>(null)
  const [cleanedPercent, setCleanedPercent] = useState(0)
  const [isComplete, setIsComplete] = useState(false)
  const cleanThreshold = 72

  function drawSlimeMask() {
    const canvas = canvasRef.current

    if (!canvas) {
      return
    }

    const rect = canvas.getBoundingClientRect()
    const scale = window.devicePixelRatio || 1
    canvas.width = Math.round(rect.width * scale)
    canvas.height = Math.round(rect.height * scale)

    const context = canvas.getContext('2d')

    if (!context) {
      return
    }

    context.setTransform(scale, 0, 0, scale, 0, 0)
    context.clearRect(0, 0, rect.width, rect.height)
    context.globalCompositeOperation = 'source-over'
    context.shadowColor = 'rgb(57 255 20 / 0.7)'
    context.shadowBlur = 14

    const blobs = [
      { x: 0.32, y: 0.57, rx: 0.18, ry: 0.09 },
      { x: 0.68, y: 0.57, rx: 0.18, ry: 0.09 },
      { x: 0.5, y: 0.665, rx: 0.2, ry: 0.065 },
      { x: 0.42, y: 0.645, rx: 0.08, ry: 0.045 },
      { x: 0.58, y: 0.645, rx: 0.08, ry: 0.045 },
    ]

    for (const blob of blobs) {
      const gradient = context.createRadialGradient(
        blob.x * rect.width,
        blob.y * rect.height,
        4,
        blob.x * rect.width,
        blob.y * rect.height,
        blob.rx * rect.width,
      )
      gradient.addColorStop(0, 'rgb(57 255 20 / 0.96)')
      gradient.addColorStop(0.62, 'rgb(57 255 20 / 0.78)')
      gradient.addColorStop(1, 'rgb(57 255 20 / 0.08)')

      context.fillStyle = gradient
      context.beginPath()
      context.ellipse(
        blob.x * rect.width,
        blob.y * rect.height,
        blob.rx * rect.width,
        blob.ry * rect.height,
        0,
        0,
        Math.PI * 2,
      )
      context.fill()
    }

    context.shadowBlur = 0
    context.fillStyle = 'rgb(255 255 255 / 0.28)'
    for (let index = 0; index < 18; index += 1) {
      const x = rect.width * (0.25 + ((index * 0.13) % 0.5))
      const y = rect.height * (0.52 + ((index * 0.07) % 0.18))
      context.beginPath()
      context.arc(x, y, 2 + (index % 3), 0, Math.PI * 2)
      context.fill()
    }

    setCleanedPercent(0)
  }

  function calculateCleanedPercent() {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')

    if (!canvas || !context) {
      return 0
    }

    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    let dirtyPixels = 0

    for (let index = 3; index < pixels.length; index += 16) {
      if (pixels[index] > 24) {
        dirtyPixels += 1
      }
    }

    const initialDirtyPixels = Number(canvas.dataset.initialDirtyPixels || dirtyPixels || 1)
    canvas.dataset.initialDirtyPixels = initialDirtyPixels.toString()

    return Math.min(100, Math.round(100 - (dirtyPixels / initialDirtyPixels) * 100))
  }

  function wipeAt(clientX: number, clientY: number) {
    if (isComplete) {
      return
    }

    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')

    if (!canvas || !context) {
      return
    }

    const rect = canvas.getBoundingClientRect()
    const scale = window.devicePixelRatio || 1
    const x = (clientX - rect.left) * scale
    const y = (clientY - rect.top) * scale

    context.save()
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.globalCompositeOperation = 'destination-out'
    context.beginPath()
    context.arc(x, y, 34 * scale, 0, Math.PI * 2)
    context.fill()
    context.restore()

    const nextPercent = calculateCleanedPercent()
    setCleanedPercent(nextPercent)

    if (nextPercent >= cleanThreshold) {
      setIsComplete(true)
      playCleaningSuccessSound()
      window.navigator.vibrate?.([35, 25, 55])
      window.setTimeout(() => {
        cleaningResultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
      }, 120)
    }
  }

  useEffect(() => {
    const frame = window.requestAnimationFrame(drawSlimeMask)
    window.addEventListener('resize', drawSlimeMask)

    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', drawSlimeMask)
    }
  }, [])

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-flossa-black px-4 pb-6 pt-[calc(104px+env(safe-area-inset-top))] text-flossa-white">
      <div className="loading-grid absolute inset-0 opacity-30" />
      <div className="scanlines absolute inset-0 opacity-20" />

      <section className="relative z-10 flex w-full max-w-[430px] flex-col font-code uppercase">
        <div className="mb-4 text-center">
          <p className="text-[11px] tracking-[0.34em] text-terminal-500/55">UNRELATED TASK</p>
          <h1 className="mt-3 text-2xl font-semibold leading-tight tracking-[0.16em] text-terminal-500">
            Facial Cleanup
          </h1>
        </div>

        <div className="cleaning-frame relative mx-auto w-full overflow-hidden border border-terminal-500/30 bg-flossa-black/80 shadow-[0_0_46px_rgb(57_255_20_/_0.12)]">
          <img
            src={isComplete ? dorotaHappyImage : dorotaSadImage}
            alt=""
            draggable={false}
            className="block aspect-[768/1024] w-full select-none object-cover"
          />
          {!isComplete ? (
            <canvas
              ref={canvasRef}
              className="absolute inset-0 h-full w-full touch-none"
              onPointerDown={(event) => {
                playSystemSound('click')
                event.currentTarget.setPointerCapture(event.pointerId)
                wipeAt(event.clientX, event.clientY)
              }}
              onPointerMove={(event) => {
                if (event.buttons === 1) {
                  wipeAt(event.clientX, event.clientY)
                }
              }}
            />
          ) : null}
        </div>

        <div ref={cleaningResultRef} className="mt-4 min-h-[132px] text-center">
          {!isComplete ? (
            <>
              <div className="mb-3 flex items-center justify-between text-[10px] tracking-[0.22em] text-flossa-white/50">
                <span>CLEANING</span>
                <span>{cleanedPercent}%</span>
              </div>
              <div className="h-3 overflow-hidden border border-terminal-500/35 bg-flossa-graphite/70 p-[2px]">
                <div
                  className="h-full bg-terminal-500 transition-[width] duration-150"
                  style={{ width: `${cleanedPercent}%` }}
                />
              </div>
              <p className="mt-4 text-[11px] leading-5 tracking-[0.14em] text-flossa-white/58">
                Wipe the green contamination from cheeks and mouth.
              </p>
            </>
          ) : (
            <div className="animate-fade-up">
              <p className="success-pulse border border-terminal-500/45 bg-terminal-500/10 p-4 text-[12px] leading-6 tracking-[0.14em] text-terminal-500">
                You washed Dorota Wellman - unrelated task. Congratulations.
              </p>
              <button
                type="button"
                onClick={() => {
                  playSystemSound('click')
                  onComplete()
                }}
                className="mt-4 h-14 w-full border border-terminal-500/55 bg-terminal-500 px-5 text-[12px] font-semibold tracking-[0.2em] text-flossa-black shadow-[0_0_34px_rgb(57_255_20_/_0.18)] transition duration-200 hover:bg-flossa-white focus:outline-none focus:ring-2 focus:ring-terminal-500 focus:ring-offset-2 focus:ring-offset-flossa-black active:scale-[0.98]"
              >
                CONTINUE
              </button>
            </div>
          )}
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
