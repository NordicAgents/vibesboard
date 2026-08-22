'use client'

import * as React from 'react'
import Textarea from 'react-textarea-autosize'
import { motion, AnimatePresence } from 'framer-motion'

import { useEnterSubmit } from '@/lib/hooks/use-enter-submit'
import { cn } from '@vibesboard/utils'
import { IconPaperclip, IconSpinner, IconX } from '@/components/ui/icons'

export interface AttachedFile {
  id: string
  name: string
  fileKey: string
  size: number
  type: string
  status: 'uploading' | 'success' | 'error'
  error?: string
}

export interface PromptProps {
  input: string

  setInput: (value: any) => void
  onSubmit: (value: string) => Promise<void>
  isLoading: boolean
  placeholder?: string
  onStop?: () => void
  canRegenerate?: boolean
  onRegenerate?: () => void
  attachedFiles?: AttachedFile[]
  onFileSelect?: (files: FileList) => void
  onFileRemove?: (fileId: string) => void
  acceptedFileTypes?: string
  maxFiles?: number
}

function fileExtension(name: string) {
  const ext = name.split('.').pop()?.toUpperCase()
  return ext && ext.length <= 5 ? ext : ''
}

function truncateName(name: string, max = 20) {
  if (name.length <= max) return name
  const ext = name.lastIndexOf('.')
  if (ext > 0) {
    const base = name.slice(0, ext)
    const extension = name.slice(ext)
    const available = max - extension.length - 1
    return available > 3
      ? base.slice(0, available) + '…' + extension
      : name.slice(0, max - 1) + '…'
  }
  return name.slice(0, max - 1) + '…'
}

export function PromptForm({
  onSubmit,
  input,
  setInput,
  isLoading,
  placeholder = 'Message…',
  onStop,
  canRegenerate,
  onRegenerate,
  attachedFiles,
  onFileSelect,
  onFileRemove,
  acceptedFileTypes = '.pdf,.txt,.doc,.docx,.md,.json,.csv,.png,.jpg,.jpeg,.gif,.webp,.xlsx,.xls',
  maxFiles = 5
}: PromptProps) {
  const { formRef, onKeyDown } = useEnterSubmit()
  const inputRef = React.useRef<HTMLTextAreaElement>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const hasInput = input.trim().length > 0
  const hasFiles = attachedFiles && attachedFiles.length > 0
  const atMaxFiles = attachedFiles && attachedFiles.length >= maxFiles

  React.useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus()
    }
  }, [])

  const showStop = Boolean(isLoading && onStop)

  return (
    <form
      onSubmit={async e => {
        e.preventDefault()
        if (!input?.trim()) return
        setInput('')
        await onSubmit(input)
      }}
      ref={formRef}
    >
      {/* Claude-style: everything inside one rounded container */}
      <div
        className={cn(
          'duration-[250ms] flex flex-col rounded-[16px] border transition-all',
          'bg-[#f5f8f7] dark:bg-[#192425]',
          'border-[#e4e3e3] dark:border-[#344348]',
          'shadow-[0_1px_3px_rgba(0,0,0,0.06),_0_4px_16px_rgba(0,0,0,0.04)]',
          'focus-within:border-[#a7e26e]/60 focus-within:shadow-[0_0_0_3px_rgba(0,200,83,0.10),_0_1px_3px_rgba(0,0,0,0.06)]'
        )}
      >
        {/* Textarea */}
        <div className="px-4 pb-1 pt-3.5">
          <Textarea
            ref={inputRef}
            tabIndex={0}
            onKeyDown={onKeyDown}
            rows={1}
            maxRows={8}
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={placeholder}
            spellCheck={false}
            data-testid="chat-input"
            className="w-full resize-none bg-transparent text-[15px] leading-[1.65] text-[#222f30] placeholder:text-[#6f7f80] focus:outline-none disabled:opacity-50 dark:text-[#f5f8f7] dark:placeholder:text-[#7e8e8f]"
          />
        </div>

        {/* Attached file chips */}
        {hasFiles && (
          <div className="flex flex-wrap gap-1.5 px-4 pb-2">
            <AnimatePresence>
              {attachedFiles.map(file => (
                <motion.div
                  key={file.id}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className={cn(
                    'flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs',
                    file.status === 'error'
                      ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400'
                      : 'border-[#e4e3e3] bg-[#edecea] text-[#445e5f] dark:border-[#344348] dark:bg-[#253435] dark:text-[#9db5b6]'
                  )}
                >
                  {file.status === 'uploading' && (
                    <IconSpinner className="size-3 animate-spin" />
                  )}
                  <span className="max-w-[140px] truncate font-medium">
                    {truncateName(file.name)}
                  </span>
                  <span className="text-[10px] uppercase tracking-wide opacity-60">
                    {fileExtension(file.name)}
                  </span>
                  {onFileRemove && (
                    <button
                      type="button"
                      onClick={() => onFileRemove(file.id)}
                      className="ml-0.5 flex size-4 items-center justify-center rounded-full transition-colors hover:bg-black/10 dark:hover:bg-white/10"
                      aria-label={`Remove ${file.name}`}
                    >
                      <IconX className="size-2.5" />
                    </button>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}

        {/* Bottom toolbar — actions inside the box */}
        <div className="flex items-center justify-between px-3 pb-3 pt-1">
          {/* Left side — attachment button */}
          {onFileSelect ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={!!atMaxFiles}
                className={cn(
                  'flex size-8 items-center justify-center rounded-full border border-[#e4e3e3] bg-transparent text-[#6f7f80] transition-all duration-150 dark:border-[#344348]',
                  atMaxFiles
                    ? 'cursor-not-allowed opacity-40'
                    : 'hover:border-[#a7e26e]/30 hover:bg-[#e6ede6] hover:text-[#445e5f] dark:hover:bg-[#253435]'
                )}
                aria-label={
                  atMaxFiles ? `Maximum ${maxFiles} files` : 'Attach files'
                }
                title={
                  atMaxFiles ? `Maximum ${maxFiles} files` : 'Attach files'
                }
              >
                <IconPaperclip className="size-3.5" />
              </button>
              {hasFiles && (
                <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-accent-orange text-[9px] font-bold text-white">
                  {attachedFiles.length}
                </span>
              )}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                accept={acceptedFileTypes}
                onChange={e => {
                  if (e.target.files?.length) {
                    onFileSelect(e.target.files)
                  }
                  e.target.value = ''
                }}
              />
            </div>
          ) : (
            <div />
          )}

          {/* Right side — regenerate + send/stop */}
          <div className="flex items-center gap-2">
            {/* Regenerate button */}
            <AnimatePresence>
              {!isLoading && canRegenerate && onRegenerate && (
                <motion.button
                  type="button"
                  onClick={() => onRegenerate?.()}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  whileTap={{ scale: 0.92 }}
                  className="flex size-8 items-center justify-center rounded-full border border-[#e4e3e3] bg-transparent text-[#6f7f80] transition-all duration-150 hover:border-[#a7e26e]/30 hover:bg-[#e6ede6] hover:text-[#445e5f] dark:border-[#344348] dark:hover:bg-[#253435]"
                  aria-label="Regenerate response"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="size-3.5"
                  >
                    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                    <path d="M21 3v5h-5" />
                    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                    <path d="M3 21v-5h5" />
                  </svg>
                </motion.button>
              )}
            </AnimatePresence>

            {/* Stop / Send button */}
            <AnimatePresence mode="wait">
              {showStop ? (
                <motion.button
                  key="stop"
                  type="button"
                  onClick={() => onStop?.()}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  whileTap={{ scale: 0.92 }}
                  className="flex size-8 items-center justify-center rounded-full bg-[#222f30] text-[#f5f8f7] transition-colors duration-150 hover:bg-[#344348] dark:bg-[#f5f8f7] dark:text-[#111918]"
                  aria-label="Stop generating"
                >
                  <span className="size-3 rounded-sm bg-current" />
                </motion.button>
              ) : (
                <motion.button
                  key="send"
                  type="submit"
                  disabled={!hasInput || isLoading}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{
                    opacity: hasInput ? 1 : 0.35,
                    scale: 1
                  }}
                  whileTap={hasInput ? { scale: 0.92 } : {}}
                  className={cn(
                    'flex size-8 items-center justify-center rounded-full transition-all duration-150',
                    hasInput
                      ? 'bg-accent-orange text-primary-foreground shadow-sm hover:bg-accent-warm active:opacity-80'
                      : 'cursor-not-allowed bg-[#e4e3e3] text-[#6f7f80] dark:bg-[#344348] dark:text-[#7e8e8f]'
                  )}
                  aria-label="Send message"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="size-3.5"
                  >
                    <path d="M12 19V5" />
                    <path d="m5 12 7-7 7 7" />
                  </svg>
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </form>
  )
}
