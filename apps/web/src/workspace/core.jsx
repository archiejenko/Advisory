// Shared plumbing for the workspace: reading the store, links between records, icons and the toast queue.
import React, { useEffect, useState, useSyncExternalStore } from "react";
import {
  Home, Users, PoundSterling, ClipboardList, UsersRound, Settings, Search, Bell, Pause, Play, Mic, X, Check, ChevronLeft, ChevronRight, ChevronDown, ArrowUpRight, ArrowDownRight, ArrowRight, Undo2, Redo2, Pencil, Bot, Sparkles, KanbanSquare, Target, FileText, Inbox, MessageSquareWarning, Megaphone, Star, ReceiptText, HandCoins, Wallet, Landmark, BookOpen, Percent, CalendarCheck, Receipt, SprayCan, CalendarDays, ListChecks, FileSignature, ShieldCheck, Package, Truck, Contact, MessagesSquare, Network, Banknote, UserPlus, Palmtree, Volume2, VolumeX, AlertTriangle, Clock, Mail, Phone, Globe, Hash, Send, Plus, ArrowUpDown, PanelLeftClose, PanelLeftOpen, LogOut, RotateCcw, Eye, Building2, Link2, Zap, Info, TrendingUp, ExternalLink, Plug, Calendar, MessageCircle, LayoutGrid, List, Briefcase, CircleCheck, Circle, Droplets, Keyboard, Layers, Lock,
} from "lucide-react";

const L = { Home, Users, PoundSterling, ClipboardList, UsersRound, Settings, Search, Bell, Pause, Play, Mic, X, Check, ChevronLeft, ChevronRight, ChevronDown, ArrowUpRight, ArrowDownRight, ArrowRight, Undo2, Redo2, Pencil, Bot, Sparkles, KanbanSquare, Target, FileText, Inbox, MessageSquareWarning, Megaphone, Star, ReceiptText, HandCoins, Wallet, Landmark, BookOpen, Percent, CalendarCheck, Receipt, SprayCan, CalendarDays, ListChecks, FileSignature, ShieldCheck, Package, Truck, Contact, MessagesSquare, Network, Banknote, UserPlus, Palmtree, Volume2, VolumeX, AlertTriangle, Clock, Mail, Phone, Globe, Hash, Send, Plus, ArrowUpDown, PanelLeftClose, PanelLeftOpen, LogOut, RotateCcw, Eye, Building2, Link2, Zap, Info, TrendingUp, ExternalLink, Plug, Calendar, MessageCircle, LayoutGrid, List, Briefcase, CircleCheck, Circle, Droplets, Keyboard, Layers, Lock };
import { getState, subscribe } from "./demo/store";

/** Read the demo store; re-renders when it changes. */
export function useStore(select = (s) => s) {
  const s = useSyncExternalStore(subscribe, getState, getState);
  return select(s);
}

export function useMedia(query) {
  const get = () => typeof window !== "undefined" && window.matchMedia(query).matches;
  const [on, set] = useState(get);
  useEffect(() => { const m = window.matchMedia(query); const f = () => set(m.matches); m.addEventListener("change", f); return () => m.removeEventListener("change", f); }, [query]);
  return on;
}
export const usePhone = () => useMedia("(max-width: 767px)");

/* ---------- Links between records ---------- */
const PATH = {
  company: (id) => `/workspace/customers/companies/${id}`,
  contact: (id) => `/workspace/customers/contacts/${id}`,
  deal: (id) => `/workspace/customers/pipeline/${id}`,
  quote: (id) => `/workspace/customers/quotes/${id}`,
  conversation: (id) => `/workspace/customers/inbox/${id}`,
  invoice: (id) => `/workspace/money/invoices/${id}`,
  bill: (id) => `/workspace/money/bills/${id}`,
  job: (id) => `/workspace/work/jobs/${id}`,
  task: (id) => `/workspace/work/tasks/${id}`,
  person: (id) => `/workspace/team/people/${id}`,
  agent: (id) => `/workspace/team/agents/${id}`,
  approval: (id) => `/workspace?decision=${id}`,
};
export function hrefFor(ref, s = getState()) {
  if (!ref) return "/workspace";
  if (ref.type === "record") {
    const r = s.records.find((x) => x.id === ref.id);
    return `/workspace/${r?.appKey === "complaints" ? "customers" : "work"}/${r?.appKey || "safety"}/${ref.id}`;
  }
  return PATH[ref.type] ? PATH[ref.type](encodeURIComponent(ref.id)) : "/workspace";
}

/* ---------- Icons: one Lucide set, one distinct icon per hub and app ---------- */
export function Icon({ name, size = 18, className, label }) {
  const C = L[name] || L.Circle;
  return <C size={size} strokeWidth={1.75} className={className} aria-hidden={label ? undefined : true} aria-label={label} focusable="false" />;
}

/* ---------- Toasts ---------- */
let toasts = [];
const tsubs = new Set();
let tn = 0;
const temit = () => tsubs.forEach((f) => f(toasts));
/** Show a toast. With `undo`, it offers Undo for `ms` (30 seconds by default). */
export function toast(text, { undo, ms = undo ? 30000 : 5000 } = {}) {
  const id = ++tn;
  toasts = [...toasts.slice(-2), { id, text, undo, ms, at: Date.now() }];
  temit();
  setTimeout(() => dismissToast(id), ms);
  return id;
}
export function clearToasts() { toasts = []; temit(); }
export function dismissToast(id) { toasts = toasts.filter((t) => t.id !== id); temit(); }
export function useToasts() {
  const [v, set] = useState(toasts);
  useEffect(() => { tsubs.add(set); return () => tsubs.delete(set); }, []);
  return v;
}
