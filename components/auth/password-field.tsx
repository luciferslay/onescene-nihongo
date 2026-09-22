'use client';

import { useState } from 'react';

/** 密码输入框：默认隐藏，右侧按钮切换显示/隐藏。 */
export default function PasswordField({
  name,
  autoComplete,
  placeholder,
  minLength = 8,
}: {
  name: string;
  autoComplete: 'current-password' | 'new-password';
  placeholder?: string;
  minLength?: number;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative mt-1">
      <input
        name={name}
        type={show ? 'text' : 'password'}
        autoComplete={autoComplete}
        required
        minLength={minLength}
        maxLength={128}
        placeholder={placeholder}
        className="w-full rounded-xl border border-ink/15 bg-white px-3 py-2.5 pr-16 text-sm outline-none focus:border-coral"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full px-2 py-1 text-xs font-bold text-ink/60 hover:text-ink"
        aria-label={show ? '隐藏密码' : '显示密码'}
      >
        {show ? '隐藏' : '显示'}
      </button>
    </div>
  );
}
