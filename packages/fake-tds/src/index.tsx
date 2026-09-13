import * as React from 'react';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

export const reactInstance = React;
export const version = '1.0.0';
export function Button({ style, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} style={{ border: 0, borderRadius: 8, padding: '10px 16px', background: '#3182f6', color: 'white', cursor: 'pointer', ...style }} />;
}
export function Badge({ style, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span {...props} style={{ borderRadius: 6, padding: '3px 8px', background: '#e8f3ff', color: '#1b64da', ...style }} />;
}
export function TextField({ label, id, ...props }: InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  const generatedId = React.useId();
  return <label htmlFor={id ?? generatedId}>{label}<input {...props} id={id ?? generatedId} style={{ padding: 10, border: '1px solid #d1d6db', borderRadius: 8, ...props.style }} /></label>;
}
export interface Column<T> { key: keyof T; header: string; render?: (value: T[keyof T], row: T) => ReactNode }
export function Table<T extends Record<string, unknown>>({ columns, rows, rowKey }: { columns: Column<T>[]; rows: T[]; rowKey?: keyof T }) {
  return <table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr>{columns.map(column => <th key={String(column.key)} scope="col">{column.header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={rowKey ? String(row[rowKey]) : index}>{columns.map(column => <td key={String(column.key)}>{column.render ? column.render(row[column.key], row) : String(row[column.key] ?? '')}</td>)}</tr>)}</tbody></table>;
}
export interface ToastState { messages: string[]; toast: (message: string) => void; clear: () => void }
const ToastContext = createContext<ToastState | null>(null);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<string[]>([]);
  const toast = useCallback((message: string) => setMessages(previous => [...previous, message]), []);
  const clear = useCallback(() => setMessages([]), []);
  const value = useMemo(() => ({ messages, toast, clear }), [messages, toast, clear]);
  return <ToastContext.Provider value={value}>{children}<div role="status" aria-live="polite">{messages.join(' · ')}</div></ToastContext.Provider>;
}
export function useToast(): ToastState {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast requires ToastProvider');
  return value;
}
