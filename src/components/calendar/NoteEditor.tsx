import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { EditorContent, Extension, InputRule, textblockTypeInputRule, useEditor, useEditorState, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details'
import { Placeholder } from '@tiptap/extensions'
import { Plugin, PluginKey, Selection } from '@tiptap/pm/state'
import type { EventNote } from '../../lib/types'
import { useStore } from '../../store'
import { Button, Icon } from '../ui'
import { ToolbarIcon, type ToolIcon } from './toolbarIcons'
import { NoteSaver, clearDraft, readDraft, stableJson, type Draft, type SaveState, type Snapshot } from './noteSaver'
import { handleCalAuthError, useCalendar } from './useCalendar'
import './editor.css'

/*
 * 회의록 편집기 (Tiptap 3). 회의록을 열 때만 따로 내려받아요 (React.lazy).
 * 노션처럼 줄 맨 앞에 '# '(큰 소제목) '## '(작은 소제목) '- ' '1. ' '[] ' '> '(토글) 를 치면 바뀌어요.
 */

export type NoteStatus = 'loading' | SaveState

export interface NoteEditorHandle {
  /** 기다리지 않고 지금 저장 */
  flush(): void
}

export interface NoteEditorProps {
  eventId: string
  /** 도구 막대를 그릴 자리 (회의록 페이지 위쪽에 붙어 있는 띠 안) */
  toolbarSlot: HTMLElement | null
  onStatus: (s: NoteStatus) => void
  handleRef: { current: NoteEditorHandle | null }
  /** 일정이 지워졌으면 저장을 멈춰요 */
  paused: boolean
}

/**
 * 안드로이드 크롬(삼성 인터넷 포함): 편집기(ProseMirror)가 Enter 키 누름을 일부러 건너뛰어서,
 * 아래 Enter 단축키가 불리기 전에 브라우저가 토글 제목을 먼저 쪼개 버려요. 그래서 그때는 beforeinput 에서 막아요
 */
const ANDROID_CHROME = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent) && /Chrome\//.test(navigator.userAgent)

/**
 * 토글 제목에서 Enter: 토글을 펼치고 안쪽 첫 줄로 들어가요 (노션처럼). 처리했으면 true.
 * Tiptap 기본 동작에 맡기면 닫힌 토글에서 제목이 쪼개지며 토글이 겹겹이 생겨요.
 */
function enterToggle(editor: Editor): boolean {
  const { state, view } = editor
  const { $from, empty } = state.selection
  if (!empty || $from.parent.type.name !== 'detailsSummary') return false
  const detailsPos = $from.before($from.depth - 1)
  const dom = view.nodeDOM(detailsPos)
  if (dom instanceof HTMLElement && !dom.classList.contains('is-open')) {
    dom.querySelector<HTMLButtonElement>(':scope > button')?.click()
  }
  // 요약 바로 뒤가 토글 내용(detailsContent) 시작: 그 안 첫 줄로
  const inside = editor.state.doc.resolve($from.after() + 1)
  const tr = editor.state.tr.setSelection(Selection.near(inside, 1)).scrollIntoView()
  editor.view.dispatch(tr)
  editor.view.focus()
  return true
}

/** 노션식 단축 입력: 기본 제목 규칙(levels 2·3)은 '## ' 부터라서 '# ' → 큰 소제목, '## ' → 작은 소제목을 따로 붙여요 */
const NotionShortcuts = Extension.create({
  name: 'amShortcuts',
  // 기본 규칙보다 먼저 봐요
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => !editor.view.composing && enterToggle(editor),
    }
  },
  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        key: new PluginKey('amAndroidToggleEnter'),
        props: {
          handleDOMEvents: {
            beforeinput: (view, event) => {
              if (!ANDROID_CHROME) return false
              const e = event as InputEvent
              if ((e.inputType !== 'insertParagraph' && e.inputType !== 'insertLineBreak') || !e.cancelable) return false
              if (view.state.selection.$from.parent.type.name !== 'detailsSummary') return false
              // 브라우저가 제목을 쪼개기 전에 막고, 한글 조합이 정리된 다음(잠깐 뒤에) 노션식 Enter 를 해요
              e.preventDefault()
              window.setTimeout(() => {
                if (editor.isDestroyed) return
                if (!editor.state.selection.empty && editor.state.selection.$from.parent.type.name === 'detailsSummary') {
                  editor.commands.deleteSelection()
                }
                if (!enterToggle(editor)) editor.commands.keyboardShortcut('Enter')
              }, 30)
              return true
            },
          },
        },
      }),
    ]
  },
  addInputRules() {
    const heading = this.editor.schema.nodes.heading
    return [
      textblockTypeInputRule({ find: /^#\s$/, type: heading, getAttributes: { level: 2 } }),
      textblockTypeInputRule({ find: /^##\s$/, type: heading, getAttributes: { level: 3 } }),
      new InputRule({
        find: /^>\s$/,
        handler: ({ state, range, chain }) => {
          const $from = state.doc.resolve(range.from)
          const outer = $from.depth > 1 ? $from.node(-1).type.name : 'doc'
          // 맨 바깥 문단이나 토글 안의 문단에서만 (목록 첫 줄을 토글로 바꾸면 목록이 깨져요)
          if ($from.parent.type.name !== 'paragraph' || (outer !== 'doc' && outer !== 'detailsContent')) return null
          chain().deleteRange(range).setDetails().run()
        },
      }),
    ]
  },
})

const EXTENSIONS = [
  StarterKit.configure({
    heading: { levels: [2, 3] },
    blockquote: false,
    codeBlock: false,
    code: false,
    link: { openOnClick: false, autolink: true },
  }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Details.configure({
    persist: false,
    HTMLAttributes: { class: 'am-details' },
    renderToggleButton: ({ element, isOpen }) => {
      element.setAttribute('aria-label', isOpen ? '토글 접기' : '토글 펼치기')
      element.setAttribute('aria-expanded', String(isOpen))
    },
  }),
  DetailsSummary,
  DetailsContent,
  Placeholder.configure({
    includeChildren: true,
    placeholder: ({ node, editor }) => {
      if (node.type.name === 'detailsSummary') return '토글 제목'
      if (node.type.name === 'heading') return '소제목'
      return editor.isEmpty ? '회의 내용을 적어 보세요' : ''
    },
  }),
  NotionShortcuts,
]

/** 에디터 문서처럼 생긴 것만 (모르는 값이면 빈 문서) */
function validDoc(doc: unknown): Record<string, unknown> | null {
  return doc && typeof doc === 'object' && (doc as { type?: unknown }).type === 'doc' ? (doc as Record<string, unknown>) : null
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; note: EventNote; draft: Draft | null; offline: boolean }

export default function NoteEditor(props: NoteEditorProps) {
  const { eventId, onStatus } = props
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const onStatusRef = useRef(onStatus)
  onStatusRef.current = onStatus

  useEffect(() => {
    let alive = true
    setPhase({ kind: 'loading' })
    onStatusRef.current('loading')
    useStore
      .getState()
      .backend.fetchEventNote(eventId)
      .then(
        (note) => {
          if (alive) setPhase({ kind: 'ready', note, draft: readDraft(eventId), offline: false })
        },
        (e: unknown) => {
          if (!alive) return
          console.error(e)
          if (handleCalAuthError(e)) return
          // 인터넷이 안 돼도 이 기기에 남은 임시본이 있으면 그것으로 열어요
          const draft = readDraft(eventId)
          if (draft) setPhase({ kind: 'ready', note: { doc: null, version: draft.base, updatedAt: null }, draft, offline: true })
          else {
            const m = e instanceof Error && /[가-힣]/.test(e.message) ? e.message : '회의록을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.'
            setPhase({ kind: 'error', message: m })
            onStatusRef.current('error')
          }
        },
      )
    return () => {
      alive = false
    }
  }, [eventId, attempt])

  if (phase.kind === 'loading')
    return (
      <div className="space-y-3 py-2" aria-busy="true" aria-label="회의록 불러오는 중">
        <div className="h-4 w-4/5 animate-pulse rounded bg-muted" />
        <div className="h-4 w-3/5 animate-pulse rounded bg-muted" />
        <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
      </div>
    )
  if (phase.kind === 'error')
    return (
      <div className="rounded-2xl bg-danger-soft px-4 py-4 text-[15px] text-danger" role="alert">
        <p className="font-semibold">{phase.message}</p>
        <Button variant="secondary" size="sm" className="mt-3" onClick={() => setAttempt((n) => n + 1)}>
          다시 시도
        </Button>
      </div>
    )
  return <NoteBody key={eventId} {...props} note={phase.note} draft={phase.draft} offline={phase.offline} />
}

function NoteBody({
  eventId,
  toolbarSlot,
  onStatus,
  handleRef,
  paused,
  note,
  draft,
  offline,
}: NoteEditorProps & { note: EventNote; draft: Draft | null; offline: boolean }) {
  // 다시 열었을 때 이 기기에 저장 못 한 임시본이 서버 것과 다르면 그것으로 되살려요
  const [restore] = useState(() => (draft ? offline || stableJson(draft.doc) !== stableJson(note.doc) : false))
  const [banner, setBanner] = useState<'restored' | 'offline' | null>(restore ? (offline ? 'offline' : 'restored') : null)
  const [conflict, setConflict] = useState<EventNote | null>(null)
  const [status, setStatus] = useState<NoteStatus>('saved')
  const saverRef = useRef<NoteSaver | null>(null)
  const cache = useRef<{ doc: unknown; plainLen: number } | null>(null)
  const onStatusRef = useRef(onStatus)
  onStatusRef.current = onStatus

  const editor = useEditor({
    extensions: EXTENSIONS,
    content: validDoc(restore && draft ? draft.doc : note.doc) ?? '',
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { class: 'am-prose', 'aria-label': '회의록 내용', spellcheck: 'false' },
      // 위에 붙은 띠(뒤로·도구 막대)가 커서 줄을 가리지 않게 여유를 두고 스크롤해요
      scrollThreshold: { top: 140, bottom: 64, left: 0, right: 0 },
      scrollMargin: { top: 140, bottom: 64, left: 0, right: 0 },
    },
    onUpdate: ({ editor: ed }) => {
      cache.current = { doc: ed.getJSON(), plainLen: ed.getText().length }
      saverRef.current?.markDirty()
    },
  })

  useEffect(() => {
    if (!editor) return
    const snapshot = (): Snapshot => {
      if (!editor.isDestroyed) cache.current = { doc: editor.getJSON(), plainLen: editor.getText().length }
      const c = cache.current ?? { doc: null, plainLen: 0 }
      return { doc: c.doc, json: stableJson(c.doc), plainLen: c.plainLen }
    }
    const first = snapshot()
    if (!restore && draft) clearDraft(eventId)
    const saver = new NoteSaver(eventId, restore && draft ? draft.base : note.version, restore ? stableJson(note.doc) : first.json, {
      snapshot,
      replace: (doc) => {
        if (!editor.isDestroyed) applyDoc(editor, doc)
      },
      onState: (s) => {
        setStatus(s)
        onStatusRef.current(s)
      },
      onConflict: setConflict,
      onSaved: (plainLen) => useCalendar.getState().setHasNote(eventId, plainLen > 0),
    })
    saverRef.current = saver
    const handle: NoteEditorHandle = { flush: () => saver.flushNow() }
    handleRef.current = handle
    onStatusRef.current(saver.current)
    if (restore) saver.flush()

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') saver.flushNow()
    }
    const onPageHide = () => saver.flushNow()
    const onOnline = () => saver.retry()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('online', onOnline)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('online', onOnline)
      // 닫히거나 다른 탭으로 가도 마지막 글은 끝까지 보내요
      saver.flushNow()
      saver.close()
      if (saverRef.current === saver) saverRef.current = null
      if (handleRef.current === handle) handleRef.current = null
    }
    // editor 가 새로 만들어질 때만 (나머지는 처음 값)
  }, [editor])

  useEffect(() => {
    saverRef.current?.setPaused(paused)
  }, [paused])

  // 다른 기기에서 바뀌었다는 알림(또는 30초 새로고침): 내가 고치는 중·한글 조합 중·저장 중이 아닐 때만 받아요
  const tick = useCalendar((s) => s.remoteTick)
  const firstTick = useRef(tick)
  useEffect(() => {
    if (tick === firstTick.current || !editor) return
    const saver = saverRef.current
    if (!saver?.canTakeRemote() || editor.view.composing) return
    let alive = true
    useStore
      .getState()
      .backend.fetchEventNote(eventId)
      .then((latest) => {
        if (!alive || editor.isDestroyed || editor.view.composing || saverRef.current !== saver) return
        saver.takeRemote(latest)
      })
      .catch((e: unknown) => console.error(e))
    return () => {
      alive = false
    }
  }, [tick, editor, eventId])

  return (
    <div className="am-note">
      {toolbarSlot && editor && createPortal(<Toolbar editor={editor} />, toolbarSlot)}

      {conflict && (
        <div className="mb-4 rounded-2xl border border-accent bg-accent-soft px-4 py-3" role="alert">
          <p className="text-[15px] font-semibold text-accent-soft-ink">다른 기기에서 이 회의록을 고쳤어요</p>
          <p className="mt-0.5 text-[13px] text-ink-2">최신 내용을 보면 이 기기에서 고친 것은 사라져요.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => saverRef.current?.useLatest()}>
              최신 내용 보기
            </Button>
            <Button size="sm" onClick={() => saverRef.current?.keepMine()}>
              내 것으로 저장
            </Button>
          </div>
        </div>
      )}
      {!conflict && banner && (
        <div className="mb-4 flex items-start gap-2 rounded-2xl bg-brand-soft px-4 py-2.5 text-[14px] text-brand-ink" role="status">
          <Icon name="cloudOff" size={18} className="mt-0.5 shrink-0" />
          <p className="min-w-0 flex-1 py-0.5">
            {banner === 'offline' ? '인터넷이 안 돼서 이 기기에 남아 있던 내용을 보여 드려요. 연결되면 저장해요.' : '저장하지 못했던 내용을 되살렸어요.'}
          </p>
          <button type="button" aria-label="안내 닫기" className="-my-2.5 -mr-3 flex h-11 w-11 shrink-0 items-center justify-center rounded-full" onClick={() => setBanner(null)}>
            <Icon name="x" size={16} />
          </button>
        </div>
      )}
      {status === 'tooBig' && (
        <p className="mb-4 rounded-2xl bg-danger-soft px-4 py-2.5 text-[14px] font-semibold text-danger" role="alert">
          회의록이 너무 길어서 저장하지 못했어요. 내용을 조금 줄여 주세요.
        </p>
      )}

      <EditorContent editor={editor} />
    </div>
  )
}

/** 문서를 바꾸고, 커서는 가능한 자리로 맞춰요 */
function applyDoc(editor: Editor, doc: unknown) {
  const { from, to } = editor.state.selection
  const focused = editor.isFocused
  editor.commands.setContent(validDoc(doc) ?? '', { emitUpdate: false })
  if (!focused) return
  const max = Math.max(1, editor.state.doc.content.size - 1)
  try {
    editor.commands.setTextSelection({ from: Math.min(from, max), to: Math.min(to, max) })
  } catch {
    /* 맞출 수 없으면 그대로 */
  }
}

interface Tool {
  key: string
  icon: ToolIcon
  label: string
  active: boolean
  run: () => void
}

/** 위에 붙어 있는 도구 막대: 제목 · 목록 · 번호 · 체크 · 토글 · 구분선 · 굵게 */
function Toolbar({ editor }: { editor: Editor }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: ed }) => ({
      h2: ed.isActive('heading', { level: 2 }),
      h3: ed.isActive('heading', { level: 3 }),
      bullet: ed.isActive('bulletList'),
      ordered: ed.isActive('orderedList'),
      task: ed.isActive('taskList'),
      details: ed.isActive('details'),
      bold: ed.isActive('bold'),
    }),
  })
  const c = () => editor.chain().focus()
  const tools: Tool[] = [
    {
      key: 'heading',
      icon: 'heading',
      label: s.h2 ? '작은 소제목으로' : s.h3 ? '보통 글로' : '소제목',
      active: s.h2 || s.h3,
      // 누를 때마다 큰 소제목 → 작은 소제목 → 보통 글
      run: () => (s.h2 ? c().setHeading({ level: 3 }).run() : s.h3 ? c().setParagraph().run() : c().setHeading({ level: 2 }).run()),
    },
    { key: 'bullet', icon: 'bullet', label: '글머리 목록', active: s.bullet, run: () => c().toggleBulletList().run() },
    { key: 'ordered', icon: 'ordered', label: '번호 목록', active: s.ordered, run: () => c().toggleOrderedList().run() },
    { key: 'task', icon: 'task', label: '체크 목록', active: s.task, run: () => c().toggleTaskList().run() },
    { key: 'details', icon: 'toggle', label: '토글', active: s.details, run: () => (s.details ? c().unsetDetails().run() : c().setDetails().run()) },
    { key: 'divider', icon: 'divider', label: '구분선', active: false, run: () => c().setHorizontalRule().run() },
    { key: 'bold', icon: 'bold', label: '굵게', active: s.bold, run: () => c().toggleBold().run() },
  ]
  return (
    <div role="toolbar" aria-label="글 꾸미기" className="mx-auto grid max-w-2xl grid-cols-7 px-1.5 pb-1">
      {tools.map((t) => (
        <button
          key={t.key}
          type="button"
          aria-label={t.label}
          title={t.label}
          aria-pressed={t.key === 'divider' ? undefined : t.active}
          // 편집기 초점(휴대폰 키보드)을 뺏지 않게
          onMouseDown={(e) => e.preventDefault()}
          onClick={t.run}
          className={`flex h-11 min-w-11 items-center justify-center rounded-xl transition ${
            t.active ? 'bg-brand-soft text-brand-ink' : 'text-ink-2 hover:bg-hover active:bg-muted'
          }`}
        >
          <ToolbarIcon name={t.icon} />
          {t.key === 'heading' && (s.h2 || s.h3) && <span className="text-[11px] leading-none font-bold">{s.h2 ? '2' : '3'}</span>}
        </button>
      ))}
    </div>
  )
}
