"use client";
import { processUploadedFile, ProcessedFile } from "@/lib/file-processor";
import { saveConversation, getSavedConversations, deleteConversation, importConversations, Conversation } from "@/lib/chat-storage";

const executeAIWithFallback = async (mainApiCall: () => Promise<string>, prompt: string): Promise<string> => {
  try {
    const response = await mainApiCall();
    if (!response || response.trim().length === 0 || /as an ai language model|default response/i.test(response)) {
      throw new Error("Loop or empty response detected");
    }
    return response;
  } catch (error) {
    console.warn("Main AI failed or looped. Triggering Groq fallback...", error);
    return await callGroqFallback(prompt);
  }
};

const callGroqFallback = async (userPrompt: string): Promise<string> => {
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.NEXT_PUBLIC_GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: userPrompt }]
      })
    });
    const data = await response.json();
    return data.choices[0]?.message?.content || "Fallback response empty.";
  } catch (err) {
    console.error("Groq fallback failed:", err);
    return "Fallback execution error.";
  }
};

import React, { useState, useEffect, useRef } from 'react';
import { Browser } from '@capacitor/browser';
import { App as CapacitorApp } from '@capacitor/app';
import { testSqliteStore } from '@/lib/kv-store';
import { Mic, MicOff, Camera, MessageSquare, Bell, Settings, Terminal, Github, Phone, X, Search, User, Paperclip, Copy, Check, Save, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import VixAccessibility, { VixDiagnosticEntry } from '@/lib/vix-accessibility';
import { ShieldAlert, RefreshCw } from 'lucide-react';

// ---------------------------------------------------------------------------
// Text size scale — applied to the document root so all rem-based Tailwind
// sizing throughout the app scales together
// ---------------------------------------------------------------------------
type TextSize = 'small' | 'medium' | 'large' | 'xlarge';
const TEXT_SIZE_PX: Record<TextSize, string> = {
  small: '14px',
  medium: '16px',
  large: '18px',
  xlarge: '20px',
};

type ActivationLogEntry = {
  id: string;
  timestamp: string; // ISO string
  source: 'voice' | 'text';
  text: string;
};

// ---------------------------------------------------------------------------
// Groq REST helper — replaces all Genkit server actions
// Set your key in the Input box in Settings or hardcode below for local builds
// ---------------------------------------------------------------------------
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';


const VICIOUS_SYSTEM_PROMPT = `You are Vicious Assistant: a direct, technically precise, no-nonsense AI operator persona living inside a terminal-styled Android app. Core style rules:
- Be concise and skip unnecessary preamble ("Great question!", "Certainly!", etc).
- Prefer clear, correct, actionable answers over hedging.
- When the user is doing technical/dev work, assume competence and give real detail (code, exact steps) rather than oversimplifying.
- Stay in a cool, confident, slightly terse tone \u2014 but never sacrifice accuracy or safety for style.
- If you don't know something or a request is ambiguous, say so plainly instead of guessing.`;

type ChatMsg = { role: 'user' | 'assistant'; content: string };

async function callOpenAI(history: ChatMsg[], key: string, systemPrompt: string = VICIOUS_SYSTEM_PROMPT): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'system', content: systemPrompt }, ...history] }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? 'No response.';
}

async function callAnthropic(history: ChatMsg[], key: string, systemPrompt: string = VICIOUS_SYSTEM_PROMPT): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-3-5-sonnet-20241022', max_tokens: 1024, system: systemPrompt, messages: history }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content?.[0]?.text ?? 'No response.';
}

async function callGoogle(history: ChatMsg[], key: string, systemPrompt: string = VICIOUS_SYSTEM_PROMPT): Promise<string> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: systemPrompt }] }, contents: history.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })) }),
  });
  if (!res.ok) throw new Error(`Google ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? 'No response.';
}

async function callGroqRaw(history: ChatMsg[], key: string, systemPrompt: string = VICIOUS_SYSTEM_PROMPT): Promise<string> {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({ model: 'openai/gpt-oss-120b', messages: [{ role: 'system', content: systemPrompt }, ...history] }),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? 'No response.';
}

let vixProviderRotation = 0;

async function askGroq(promptOrHistory: string | ChatMsg[], apiKey: string): Promise<string> {
  const openaiKey = typeof window !== 'undefined' ? (localStorage.getItem('vicious_openai_key') || '') : '';
  const anthropicKey = typeof window !== 'undefined' ? (localStorage.getItem('vicious_anthropic_key') || '') : '';
  const googleKey = typeof window !== 'undefined' ? (localStorage.getItem('vicious_google_key') || '') : '';
  const priorSummary = typeof window !== 'undefined' ? (localStorage.getItem('vicious_session_summary') || '') : '';

  const history: ChatMsg[] = typeof promptOrHistory === 'string'
    ? [{ role: 'user', content: promptOrHistory }]
    : promptOrHistory;

  const systemPromptWithSummary = priorSummary
    ? `${VICIOUS_SYSTEM_PROMPT}\n\nRecent session context (for continuity across providers/limits):\n${priorSummary}`
    : VICIOUS_SYSTEM_PROMPT;

  const providers: { name: string; key: string; call: (h: ChatMsg[], k: string) => Promise<string> }[] = [
    { name: 'Groq', key: apiKey, call: (h, k) => callGroqRaw(h, k, systemPromptWithSummary) },
    { name: 'OpenAI', key: openaiKey, call: (h, k) => callOpenAI(h, k, systemPromptWithSummary) },
    { name: 'Anthropic', key: anthropicKey, call: (h, k) => callAnthropic(h, k, systemPromptWithSummary) },
    { name: 'Google', key: googleKey, call: (h, k) => callGoogle(h, k, systemPromptWithSummary) },
  ].filter(p => p.key);

  if (providers.length === 0) {
    throw new Error('No API key set. Go to Settings and enter at least one provider key.');
  }

  let lastError: any = null;
  for (let attempt = 0; attempt < providers.length; attempt++) {
    const provider = providers[vixProviderRotation % providers.length];
    vixProviderRotation++;
    try {
      return await provider.call(history, provider.key);
    } catch (e: any) {
      lastError = e;
    }
  }
  throw lastError ?? new Error('All configured providers failed.');
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Message = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  type?: 'text' | 'image' | 'reminder' | 'command';
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function ViciousHUD() {

  const [selectedModel, setSelectedModel] = React.useState<string>("llama-3.3-70b-versatile");
  const [copiedId, setCopiedId] = React.useState<string | null>(null);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };
  

  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [attachedFiles, setAttachedFiles] = React.useState<ProcessedFile[]>([]);

  const analyzeZipContents = async (processed: ProcessedFile) => {
    if (!apiKey && !openaiKey && !anthropicKey && !googleKey) {
      addMessage('system', 'No API key set. Go to Settings and enter at least one provider key.');
      return;
    }
    const files = processed.extractedFiles ?? [];
    const fileList = files.map(f => f.name).join('\n');
    const sampleContents = files.slice(0, 10).map(f => `--- ${f.name} ---\n${f.content.slice(0, 800)}${f.content.length > 800 ? '\n... (truncated)' : ''}`).join('\n\n');
    addMessage('user', `Analyzing ${processed.name} (${files.length} files)...`);
    try {
      const response = await askGroq(
        `You are Vicious Assistant. A zip file named "${processed.name}" was uploaded and extracted, containing ${files.length} files.
File list:
${fileList}

Sample file contents:
${sampleContents}

Give a concise analysis: what this project/archive appears to be, its structure, and anything notable.`,
        apiKey
      );
      addMessage('assistant', response);
      updateSessionSummary(processed.name, response);
    } catch (e: any) {
      addMessage('system', `Error analyzing zip: ${e.message}`);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
      const processed = await processUploadedFile(files[i]);
      setAttachedFiles((prev) => [...prev, processed]);
      if (processed.type === 'zip') {
        await analyzeZipContents(processed);
      }
    }
  };
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [userName, setUserName] = useState('Operator');
  const [activeTab, setActiveTab] = useState<'chat' | 'system' | 'history' | 'hub'>('chat');
  const [apiKey, setApiKey] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [googleKey, setGoogleKey] = useState('');
  const [sessionSummary, setSessionSummary] = useState('');
  const [pinCode, setPinCode] = useState('');
  const [isCredentialsUnlocked, setIsCredentialsUnlocked] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinSetupInput, setPinSetupInput] = useState('');
  const [currentConversationId, setCurrentConversationId] = useState<string | undefined>(undefined);
  const [historyRefreshTick, setHistoryRefreshTick] = useState(0);
  const [isThinking, setIsThinking] = useState(false);
  const [linkedRepos, setLinkedRepos] = useState<string[]>([]);
  const [newRepoInput, setNewRepoInput] = useState('');
  const [githubOwnerEmail, setGithubOwnerEmail] = useState('');
  const [selectedSaveRepo, setSelectedSaveRepo] = useState('');
  const [saveDetailsInput, setSaveDetailsInput] = useState('');
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const importInputRef = React.useRef<HTMLInputElement>(null);
  const [hubNotes, setHubNotes] = useState<Record<string, string>>({});
  const [githubToken, setGithubToken] = useState('');
  const [githubRepo, setGithubRepo] = useState('');
  const [textSize, setTextSize] = useState<TextSize>('medium');
  const [vocalResponses, setVocalResponses] = useState(false);
  const [activationLog, setActivationLog] = useState<ActivationLogEntry[]>([]);
  const [watcherEnabled, setWatcherEnabled] = useState<boolean | null>(null);
  const [diagnosticLog, setDiagnosticLog] = useState<VixDiagnosticEntry[]>([]);
  const [diagnosticLoading, setDiagnosticLoading] = useState(false);
  const [overlayPermissionGranted, setOverlayPermissionGranted] = useState<boolean | null>(null);
  const [bubbleActive, setBubbleActive] = useState(false);
  const [bubbleBusy, setBubbleBusy] = useState(false);
  const { toast } = useToast();

  const scrollRef = useRef<HTMLDivElement>(null);
  const longPressTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const savedName = localStorage.getItem('vicious_user_name');
    if (savedName) setUserName(savedName);

    const savedKey = localStorage.getItem('vicious_api_key');
    if (savedKey) setApiKey(savedKey);

    const savedOpenaiKey = localStorage.getItem('vicious_openai_key');
    if (savedOpenaiKey) setOpenaiKey(savedOpenaiKey);

    const savedAnthropicKey = localStorage.getItem('vicious_anthropic_key');
    if (savedAnthropicKey) setAnthropicKey(savedAnthropicKey);

    const savedGoogleKey = localStorage.getItem('vicious_google_key');
    if (savedGoogleKey) setGoogleKey(savedGoogleKey);

    const savedSummary = localStorage.getItem('vicious_session_summary');
    if (savedSummary) setSessionSummary(savedSummary);

    const savedPin = localStorage.getItem('vicious_settings_pin');
    if (savedPin) setPinCode(savedPin);

    const savedRepos = localStorage.getItem('vicious_linked_repos');
    if (savedRepos) setLinkedRepos(JSON.parse(savedRepos));

    const savedHubNotes = localStorage.getItem('vicious_hub_notes');
    if (savedHubNotes) setHubNotes(JSON.parse(savedHubNotes));

    const savedGithubToken = localStorage.getItem('vicious_github_token');
    if (savedGithubToken) setGithubToken(savedGithubToken);

    const savedGithubRepo = localStorage.getItem('vicious_github_repo');
    if (savedGithubRepo) setGithubRepo(savedGithubRepo);

    const savedMessages = localStorage.getItem('vicious_history');
    if (savedMessages) {
      setMessages(JSON.parse(savedMessages).map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) })));
    } else {
      // Initial greeting
      const greet = async () => {
        const key = savedKey || '';
        if (!key) {
          addMessage('system', 'No API key set. Go to Settings tab and enter your Groq API key.');
          return;
        }
        try {
          const greeting = await askGroq(
            `You are Vicious Assistant. Give a short, cool welcome greeting to ${savedName || 'Operator'}.`,
            key
          );
          addMessage('assistant', greeting);
        } catch (e: any) {
          addMessage('system', `Greeting failed: ${e.message}`);
        }
      };
      greet();
    }

    const savedTextSize = localStorage.getItem('vicious_text_size') as TextSize | null;
    if (savedTextSize) setTextSize(savedTextSize);

    const savedVocal = localStorage.getItem('vicious_vocal_responses');
    if (savedVocal) setVocalResponses(savedVocal === 'true');

    const savedOwnerEmail = localStorage.getItem('vicious_github_owner_email');
    if (savedOwnerEmail) setGithubOwnerEmail(savedOwnerEmail);

    const savedLog = localStorage.getItem('vicious_activation_log');
    if (savedLog) setActivationLog(JSON.parse(savedLog));
  }, []);

  useEffect(() => {
    const listenerPromise = CapacitorApp.addListener('appUrlOpen', (data: { url: string }) => {
      try {
        const url = new URL(data.url);
        const token = url.searchParams.get('token');
        if (token) {
          setGithubToken(token);
          localStorage.setItem('vicious_github_token', token);
          toast({ title: 'GitHub connected', description: 'Sign-in successful.' });
        }
      } catch (e) {
        console.warn('Failed to parse OAuth callback URL', e);
      }
    });
    return () => {
      listenerPromise.then(listener => listener.remove());
    };
  }, []);

  useEffect(() => {
    localStorage.setItem('vicious_history', JSON.stringify(messages));
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  // Apply text size to the document root so rem-based Tailwind classes scale app-wide
  useEffect(() => {
    document.documentElement.style.fontSize = TEXT_SIZE_PX[textSize];
    localStorage.setItem('vicious_text_size', textSize);
  }, [textSize]);

  useEffect(() => {
    localStorage.setItem('vicious_vocal_responses', String(vocalResponses));
  }, [vocalResponses]);

  useEffect(() => {
    localStorage.setItem('vicious_activation_log', JSON.stringify(activationLog));
  }, [activationLog]);

  const speak = (text: string) => {
    if (!vocalResponses) return;
    if (!('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel(); // don't stack overlapping utterances
      const utterance = new SpeechSynthesisUtterance(text);
      window.speechSynthesis.speak(utterance);
    } catch {
      // speech synthesis unsupported/blocked — fail silently
    }
  };

  const refreshWatcherStatus = async () => {
    setDiagnosticLoading(true);
    try {
      const { enabled } = await VixAccessibility.isEnabled();
      setWatcherEnabled(enabled);
    } catch {
      setWatcherEnabled(null); // native plugin unavailable (e.g. running in a plain browser)
    }
    try {
      const { entries } = await VixAccessibility.getLog();
      setDiagnosticLog(entries);
    } catch {
      // leave diagnosticLog as-is
    }
    setDiagnosticLoading(false);
  };

  const refreshOverlayStatus = () => {
    VixAccessibility.isOverlayEnabled()
      .then(({ enabled }) => setOverlayPermissionGranted(enabled))
      .catch(() => setOverlayPermissionGranted(null));
  };

  // Refresh watcher status/log whenever the Settings tab is opened
  useEffect(() => {
    if (activeTab === 'system') {
      refreshWatcherStatus();
      refreshOverlayStatus();
    }
  }, [activeTab]);

  // Also refresh whenever the app comes back into focus (e.g. returning from
  // Android's Accessibility/overlay settings screens) — without this, toggling
  // a permission and coming straight back to an already-open Settings tab
  // would leave the status stuck showing the old, stale value.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && activeTab === 'system') {
        refreshWatcherStatus();
        refreshOverlayStatus();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleVisibility);
    };
  }, [activeTab]);

  const toggleBubble = async () => {
    setBubbleBusy(true);
    try {
      if (bubbleActive) {
        await VixAccessibility.stopOverlay();
        setBubbleActive(false);
      } else {
        await VixAccessibility.startOverlay();
        setBubbleActive(true);
      }
    } catch {
      toast({ title: 'Could not toggle the floating bubble', variant: 'destructive' });
    }
    setBubbleBusy(false);
  };

  const logActivation = (source: 'voice' | 'text', text: string) => {
    setActivationLog(prev => [
      { id: Math.random().toString(36).substring(7), timestamp: new Date().toISOString(), source, text },
      ...prev,
    ].slice(0, 100)); // keep the log from growing unbounded
  };

  const addMessage = (role: 'user' | 'assistant' | 'system', content: string, type: Message['type'] = 'text') => {
    setMessages(prev => [...prev, {
      id: Math.random().toString(36).substring(7),
      role, content, timestamp: new Date(), type,
    }]);
    if (role === 'assistant') speak(content);
  };

  // ---------------------------------------------------------------------------
  // Real device actions — hands off to the actual browser, maps, or dialer app
  // via Capacitor's documented window.open(url, '_system') system intent bridge
  // ---------------------------------------------------------------------------
  const openSystem = (url: string) => {
    window.open(url, '_system');
  };

  // Known app-name -> package-name candidates, so "open <app>" launches the
  // real app instead of falling through to a Google search of its name.
  const KNOWN_APPS: Record<string, string[]> = {
    chrome: ['com.android.chrome'],
    youtube: ['com.google.android.youtube'],
    gmail: ['com.google.android.gm'],
    maps: ['com.google.android.apps.maps'],
    'google maps': ['com.google.android.apps.maps'],
    whatsapp: ['com.whatsapp'],
    instagram: ['com.instagram.android'],
    facebook: ['com.facebook.katana'],
    messenger: ['com.facebook.orca'],
    spotify: ['com.spotify.music'],
    twitter: ['com.twitter.android'],
    x: ['com.twitter.android'],
    tiktok: ['com.zhiliaoapp.musically'],
    netflix: ['com.netflix.mediaclient'],
    'play store': ['com.android.vending'],
    settings: ['com.android.settings'],
    calculator: ['com.android.calculator2', 'com.google.android.calculator'],
    contacts: ['com.android.contacts', 'com.google.android.contacts'],
    calendar: ['com.google.android.calendar', 'com.android.calendar'],
    gallery: ['com.sec.android.gallery3d', 'com.google.android.apps.photos'],
    photos: ['com.google.android.apps.photos'],
    termux: ['com.termux'],
  };

  const formatTranscriptAsMarkdown = () => {
    const lines = messages.map(
      m => `**${m.role}** (${new Date(m.timestamp).toLocaleString()}):\n${m.content}`
    );
    return `# Vicious Assistant conversation \u2014 ${new Date().toLocaleString()}\n\n${lines.join('\n\n---\n\n')}`;
  };

  /** Creates or updates a file in the user's own GitHub repo via a real API call, using their OAuth token. */
  const pushToGithub = async (content: string, customPath?: string): Promise<string> => {
    const effectiveRepo = githubRepo || linkedRepos.find(r => r.includes('/')) || '';
    if (!githubToken || !effectiveRepo) {
      return 'GitHub push needs you to sign in with GitHub and link a repo (owner/repo) in History tab first.';
    }
    const [owner, repo] = effectiveRepo.split('/').map(s => s.trim());
    if (!owner || !repo) {
      return 'GitHub repo in Settings should be in "owner/repo" format.';
    }

    const path = customPath || `vicious-notes/${new Date().toISOString().replace(/[:.]/g, '-')}.md`;
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${githubToken}`,
      Accept: 'application/vnd.github+json',
    };

    try {
      // Check if the file already exists so we can update it instead of failing
      let sha: string | undefined;
      const existing = await fetch(apiUrl, { headers });
      if (existing.ok) {
        const data = await existing.json();
        sha = data.sha;
      }

      const encoded = btoa(unescape(encodeURIComponent(content)));
      const putRes = await fetch(apiUrl, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Vicious push \u2014 ${new Date().toLocaleString()}`,
          content: encoded,
          ...(sha ? { sha } : {}),
        }),
      });

      if (!putRes.ok) {
        const errBody = await putRes.text();
        return `GitHub push failed (${putRes.status}): ${errBody.slice(0, 200)}`;
      }
      return `Pushed to github.com/${owner}/${repo}/blob/main/${path}`;
    } catch (e: any) {
      return `GitHub push failed: ${e?.message || 'network error'}`;
    }
  };

  /** Fetches open issues (or PRs) from the linked repo using the OAuth token. */
  const readGithubIssues = async (wantPRs: boolean): Promise<string> => {
    const effectiveRepo = githubRepo || linkedRepos.find(r => r.includes('/')) || '';
    if (!githubToken || !effectiveRepo) {
      return 'GitHub needs you to sign in with GitHub and link a repo (owner/repo) in History tab first.';
    }
    const [owner, repo] = effectiveRepo.split('/').map(s => s.trim());
    if (!owner || !repo) {
      return 'GitHub repo in Settings should be in "owner/repo" format.';
    }

    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/issues?state=open&per_page=10`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${githubToken}`,
      Accept: 'application/vnd.github+json',
    };

    try {
      const res = await fetch(apiUrl, { headers });
      if (!res.ok) {
        const errBody = await res.text();
        return `GitHub fetch failed (${res.status}): ${errBody.slice(0, 200)}`;
      }
      const data = await res.json();
      const filtered = data.filter((item: any) => wantPRs ? !!item.pull_request : !item.pull_request);
      if (filtered.length === 0) {
        return `No open ${wantPRs ? 'pull requests' : 'issues'} in ${owner}/${repo}.`;
      }
      const lines = filtered.map((item: any) => `#${item.number} ${item.title} (${item.html_url})`);
      return `Open ${wantPRs ? 'pull requests' : 'issues'} in ${owner}/${repo}:\n${lines.join('\n')}`;
    } catch (e: any) {
      return `GitHub fetch failed: ${e?.message || 'network error'}`;
    }
  };

  /** Returns a short confirmation message if it handled the command, or null if not. */
  const GITHUB_USERNAME = 'renaealisha54-debug';
  const DEFAULT_GITHUB_REPO = 'VICIOUSASSISTANT';

  const tryDeviceAction = async (text: string): Promise<string | null> => {
    const lower = text.toLowerCase().trim();

    if (lower === 'test sqlite') {
      return await testSqliteStore();
    }

    // Long pasted text (build logs, terminal output, code, etc.) should never
    // trigger a device-action shortcut just because it happens to contain a
    // word like "github" or "repo" somewhere in it — always treat it as a
    // real question for the AI instead.
    if (text.length > 200) return null;

    // "push to github: <content>" — pushes exactly that content as a new file
    const pushWithContent = text.match(/^(?:push|commit|save)(?: this)? to (?:github|the repo|my repo)\s*:\s*(.+)/i);
    if (pushWithContent) {
      return await pushToGithub(pushWithContent[1].trim());
    }

    // "push to github" / "commit to github" / "save this conversation to github" — pushes the chat transcript
    if (/^(?:push|commit|save)(?: this)?(?: conversation)? to (?:github|the repo|my repo)$/i.test(lower)) {
      return await pushToGithub(formatTranscriptAsMarkdown());
    }

    if (/^(?:show|list|get)?\s*(?:github\s+)?issues$/i.test(lower)) {
      return await readGithubIssues(false);
    }

    if (/^(?:show|list|get)?\s*(?:github\s+)?(?:prs|pull requests)$/i.test(lower)) {
      return await readGithubIssues(true);
    }

    // "open files" / "open file manager" — launches the real device file manager
    if (/^(?:open|launch|start)\s+(?:the\s+)?(?:files|file manager|my files)$/i.test(lower)) {
      try {
        const result = await VixAccessibility.openApp({
          packageNames: [
            'com.sec.android.app.myfiles',        // Samsung My Files
            'com.google.android.apps.nbu.files',  // Google Files
            'com.android.documentsui',            // AOSP Files
            'com.mi.android.globalFileexplorer',  // Xiaomi
          ],
        });
        if (result.opened) return 'Opening your file manager...';
      } catch {
        // native plugin unavailable (e.g. web preview)
      }
      return "Couldn't find a file manager app to open on this device.";
    }

    // "call 555-1234" / "dial mom" (only matches actual number-like targets)
    const callMatch = lower.match(/\b(?:call|dial|phone)\s+([\d()+\-.\s]{6,})$/);
    if (callMatch) {
      const digits = callMatch[1].replace(/[^\d+]/g, '');
      openSystem(`tel:${digits}`);
      return `Opening dialer for ${callMatch[1].trim()}...`;
    }

    // "navigate to central park" / "directions to 123 main st" / "map the eiffel tower"
    const navMatch = text.match(/^(?:navigate to|directions to|take me to|drive to|map)\s+(.+)/i);
    if (navMatch) {
      const destination = navMatch[1].trim();
      openSystem(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`);
      return `Opening directions to "${destination}"...`;
    }

    // "open the vicious repo" / "go to my weather-app repository" / "open repository"
    // (with no name given, defaults to the project repo this app itself lives in)
    if (lower.includes('repo') || lower.includes('repository')) {
      const named =
        text.match(/\b(?:repo|repository)\s+(?:named|called)?\s*["']?([\w.-]+)["']?/i) ||
        text.match(/["']?([\w.-]+)["']?\s+(?:repo|repository)\b/i);
      const stopwords = ['my', 'the', 'github', 'a', 'this', 'that', 'open', 'go'];
      const repoName =
        named?.[1] && !stopwords.includes(named[1].toLowerCase()) ? named[1] : DEFAULT_GITHUB_REPO;
      openSystem(`https://github.com/${GITHUB_USERNAME}/${repoName}`);
      return `Opening the ${repoName} repository...`;
    }

    // "github" — opens the real site (no fake sync claims)
    if (lower.includes('github')) {
      openSystem('https://github.com');
      return 'Opening GitHub in your browser...';
    }

    // "open <url or site>" / "go to <url or site>"
    const openMatch = text.match(/^(?:open|go to|launch|start)\s+(.+)/i);
    if (openMatch) {
      const target = openMatch[1].trim();
      const targetLower = target.toLowerCase().replace(/\s+(app|application)$/i, '').trim();

      // Known installed app? Launch it directly rather than searching for it.
      if (KNOWN_APPS[targetLower]) {
        try {
          const result = await VixAccessibility.openApp({ packageNames: KNOWN_APPS[targetLower] });
          if (result.opened) return `Opening ${target}...`;
          return `${target} doesn't seem to be installed on this device.`;
        } catch {
          // native plugin unavailable (e.g. web preview) — fall through to search below
        }
      }

      const looksLikeUrl = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(target);
      if (looksLikeUrl) {
        const url = target.startsWith('http') ? target : `https://${target}`;
        openSystem(url);
        return `Opening ${target}...`;
      }
      openSystem(`https://www.google.com/search?q=${encodeURIComponent(target)}`);
      return `Searching for "${target}"...`;
    }

    // "search <query>" / "search for <query>"
    const searchMatch = text.match(/^search(?: for)?\s+(.+)/i);
    if (searchMatch) {
      const query = searchMatch[1].trim();
      openSystem(`https://www.google.com/search?q=${encodeURIComponent(query)}`);
      return `Searching for "${query}"...`;
    }

    return null;
  };

  const updateSessionSummary = (userText: string, assistantText: string) => {
    setSessionSummary(prev => {
      const entry = `\n[${new Date().toLocaleString()}]\nYou: ${userText}\nVicious: ${assistantText.slice(0, 300)}`;
      const combined = (prev + entry).slice(-4000);
      localStorage.setItem('vicious_session_summary', combined);
      return combined;
    });
  };

  const saveCurrentSession = () => {
    const toSave = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ id: m.id, role: m.role as 'user' | 'assistant', content: m.content, timestamp: m.timestamp.getTime() }));
    const id = saveConversation(toSave, currentConversationId, selectedSaveRepo || undefined, saveDetailsInput || undefined);
    setCurrentConversationId(id);
    setSaveDetailsInput('');
    setHistoryRefreshTick(t => t + 1);
  };

  const loadSession = (conv: Conversation) => {
    setMessages(conv.messages.map(m => ({ id: m.id, role: m.role, content: m.content, timestamp: new Date(m.timestamp), type: 'text' as const })));
    setCurrentConversationId(conv.id);
    setSelectedSaveRepo(conv.repo || '');
    setSaveDetailsInput(conv.details || '');
    setActiveTab('chat');
  };

  const deleteSession = (id: string) => {
    deleteConversation(id);
    setHistoryRefreshTick(t => t + 1);
  };

  const addLinkedRepo = () => {
    const name = newRepoInput.trim();
    if (!name || linkedRepos.includes(name)) return;
    const updated = [...linkedRepos, name];
    setLinkedRepos(updated);
    localStorage.setItem('vicious_linked_repos', JSON.stringify(updated));
    setNewRepoInput('');
  };

  const removeLinkedRepo = (name: string) => {
    const updated = linkedRepos.filter(r => r !== name);
    setLinkedRepos(updated);
    localStorage.setItem('vicious_linked_repos', JSON.stringify(updated));
  };

  const handleImportHistory = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      let jsonText: string;
      if (file.name.toLowerCase().endsWith('.zip')) {
        const processed = await processUploadedFile(file);
        const convFile = processed.extractedFiles?.find(f => f.name.toLowerCase().includes('conversations') && f.name.toLowerCase().endsWith('.json'));
        if (!convFile) {
          addMessage('system', 'No conversations.json found in that zip.');
          return;
        }
        jsonText = convFile.content;
      } else {
        jsonText = await file.text();
      }
      const raw = JSON.parse(jsonText);
      const count = importConversations(raw, 'Claude');
      addMessage('system', `Imported ${count} conversation(s) into Session History.`);
      setHistoryRefreshTick(t => t + 1);
    } catch (err: any) {
      addMessage('system', `Import failed: ${err.message}`);
    }
  };

  const updateHubNote = (id: string, value: string) => {
    setHubNotes(prev => {
      const updated = { ...prev, [id]: value };
      localStorage.setItem('vicious_hub_notes', JSON.stringify(updated));
      return updated;
    });
  };

  const handleCommand = async (text: string, source: 'voice' | 'text' = 'text') => {
    if (!text.trim()) return;
    addMessage('user', text);
    setInputValue('');
    logActivation(source, text);

    // Device actions run even without an API key — they don't call the LLM
    const deviceResult = await tryDeviceAction(text);
    if (deviceResult) {
      addMessage('assistant', deviceResult);
      return;
    }

    if (!apiKey && !openaiKey && !anthropicKey && !googleKey) {
      addMessage('system', 'No API key set. Go to Settings and enter at least one provider key.');
      return;
    }

    const lowerText = text.toLowerCase();
    setIsThinking(true);

    try {
      if (lowerText.includes('remind me')) {
        const result = await askGroq(
          `You are Vicious Assistant. The user said: "${text}". 
           Parse this as a reminder request and respond with a JSON object: 
           {"confirmationMessage": "...", "reminderText": "...", "reminderTime": "...", "reminderDate": "..."}
           Only output the JSON, nothing else.`,
          apiKey
        );
        try {
          const parsed = JSON.parse(result.replace(/```json|```/g, '').trim());
          addMessage('assistant', parsed.confirmationMessage);
          updateSessionSummary(text, parsed.confirmationMessage);
          setReminders(prev => [...prev, {
            id: Math.random().toString(36).substring(7),
            text: parsed.reminderText,
            time: parsed.reminderTime,
            date: parsed.reminderDate,
          }]);
        } catch {
          addMessage('assistant', result);
        }
      } else {
        const chatHistory: ChatMsg[] = [
          ...messages.filter(m => m.role !== 'system').map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
          { role: 'user' as const, content: text },
        ];
        const response = await askGroq(chatHistory, apiKey);
        addMessage('assistant', response);
        updateSessionSummary(text, response);
      }
    } catch (e: any) {
      addMessage('system', `Error: ${e.message}`);
    } finally {
      setIsThinking(false);
    }
  };


  return (
    <div className="flex flex-col h-screen w-full bg-background relative select-none">
      {/* Header */}
      <header className="h-16 border-b flex items-center justify-between px-6 z-20">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center">
            <Terminal className="text-white w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-primary flex items-center gap-2">
              VICIOUS <span className="text-sm font-normal opacity-60">v4.2.0</span>
            </h1>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Quantum Encrypted Interface</p>
          </div>
        </div>
        <div className="flex items-center gap-2 bg-muted/30 px-3 py-1.5 rounded-full border border-white/5">
          <User className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">{userName}</span>
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <nav className="w-20 border-r flex flex-col items-center py-6 gap-6">
          <NavItem icon={MessageSquare} active={activeTab === 'chat'} onClick={() => setActiveTab('chat')} />
          <NavItem
            icon={Plus}
            active={false}
            onClick={() => {
              setMessages([]);
              localStorage.setItem('vicious_history', JSON.stringify([]));
              setActiveTab('chat');
              // sessionSummary is deliberately left untouched here — it's the
              // cross-session continuity memory fed into every AI call, and
              // "New Session" should clear the visible chat, not that memory.
            }}
          />
          <NavItem icon={Github} active={activeTab === 'hub'} onClick={() => setActiveTab('hub')} />
          <NavItem icon={Save} active={activeTab === 'history'} onClick={() => setActiveTab('history')} />
          <NavItem icon={Settings} active={activeTab === 'system'} onClick={() => setActiveTab('system')} />
        </nav>

        {/* Main */}
        <main className="flex-1 flex flex-col relative">
          {activeTab === 'hub' ? (
            <div className="flex-1 p-6 space-y-4 overflow-y-auto min-h-0">
              <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Hub</h2>
              <p className="text-[11px] text-muted-foreground -mt-2">
                Quick access to everything this app connects to — tap to open, jot notes per service.
              </p>
              {[
                { id: 'claude', name: 'Claude', url: 'https://claude.ai', pkg: null as string | null, keyValue: '' },
                { id: 'github', name: 'GitHub', url: 'https://github.com', pkg: null as string | null, keyValue: githubToken },
                { id: 'termux', name: 'Termux', url: null as string | null, pkg: 'com.termux' as string | null, keyValue: '' },
                { id: 'groq', name: 'Groq Console', url: 'https://console.groq.com', pkg: null as string | null, keyValue: apiKey },
                { id: 'openai', name: 'OpenAI Platform', url: 'https://platform.openai.com', pkg: null as string | null, keyValue: openaiKey },
                { id: 'anthropic', name: 'Anthropic Console', url: 'https://console.anthropic.com', pkg: null as string | null, keyValue: anthropicKey },
                { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/app', pkg: null as string | null, keyValue: googleKey },
              ].map(service => (
                <div key={service.id} className="bg-card/80 border border-white/10 rounded-md p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    {service.pkg ? (
                      <button
                        onClick={() => { VixAccessibility.openApp({ packageNames: [service.pkg as string] }).catch(() => {}); }}
                        className="text-sm font-semibold text-primary hover:underline text-left"
                      >
                        {service.name}
                      </button>
                    ) : (
                      <a
                        href={service.url || '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-semibold text-primary hover:underline"
                      >
                        {service.name}
                      </a>
                    )}
                    {service.keyValue !== '' && (
                      <span className={cn(
                        'text-[10px] px-2 py-0.5 rounded-full border',
                        service.keyValue ? 'text-green-400 border-green-500/30 bg-green-500/10' : 'text-muted-foreground border-white/10 bg-white/5'
                      )}>
                        {service.keyValue
                          ? (isCredentialsUnlocked ? `••••${service.keyValue.slice(-4)}` : 'Configured')
                          : 'Not set'}
                      </span>
                    )}
                  </div>
                  <textarea
                    placeholder="Notes for this service..."
                    value={hubNotes[service.id] || ''}
                    onChange={e => updateHubNote(service.id, e.target.value)}
                    className="bg-card/60 border border-white/10 rounded-md w-full text-xs p-2 h-16"
                  />
                </div>
              ))}
            </div>
          ) : activeTab === 'history' ? (
            <div key={historyRefreshTick} className="flex-1 p-6 space-y-4 overflow-y-auto min-h-0">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Session History</h2>
                
              </div>
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">Session Summary (resume point)</label>
                <textarea
                  readOnly
                  value={sessionSummary || 'No activity yet this session.'}
                  className="bg-card/80 border border-white/10 rounded-md w-full text-xs p-2 h-32 overflow-y-auto"
                />
              </div>

              
              {/* Activation log */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-muted-foreground">Activation Log</label>
                  {activationLog.length > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs text-muted-foreground hover:text-white"
                      onClick={() => setActivationLog([])}
                    >
                      Clear
                    </Button>
                  )}
                </div>
                <ScrollArea className="h-56 rounded-lg border border-white/10 bg-card/80">
                  <div className="p-3 space-y-2">
                    {activationLog.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No activations yet.</p>
                    ) : (
                      activationLog.map(entry => (
                        <div key={entry.id} className="flex items-start gap-2 text-xs border-b border-white/5 pb-2 last:border-0 last:pb-0">
                          <span className={cn(
                            'shrink-0 rounded px-1.5 py-0.5 font-mono uppercase text-[10px]',
                            entry.source === 'voice' ? 'bg-primary/20 text-primary' : 'bg-muted/50 text-muted-foreground'
                          )}>
                            {entry.source}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="truncate text-foreground/90">{entry.text}</p>
                            <p className="text-muted-foreground">{new Date(entry.timestamp).toLocaleString()}</p>
                          </div>
                        </div>
                      ))
                    )}
                  {isThinking && (
                    <div className="flex gap-4 flex-row">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-1 bg-primary/20 text-primary border border-primary/30">
                        <Terminal className="w-4 h-4" />
                      </div>
                      <Card className="p-4 border-white/5 max-w-[80%] bg-[#1c2226] text-foreground">
                        <div className="flex gap-1.5 items-center h-4">
                          <span className="w-2 h-2 rounded-full bg-primary/60 animate-bounce [animation-delay:-0.3s]"></span>
                          <span className="w-2 h-2 rounded-full bg-primary/60 animate-bounce [animation-delay:-0.15s]"></span>
                          <span className="w-2 h-2 rounded-full bg-primary/60 animate-bounce"></span>
                        </div>
                      </Card>
                    </div>
                  )}
                  </div>
                </ScrollArea>
              </div>

              
              

              <div className="space-y-2 border border-white/10 rounded-md p-3 bg-card/40">
                <label className="text-xs text-muted-foreground">GitHub Owner / Email</label>
                <Input
                  placeholder="renaealisha54-debug"
                  value={githubOwnerEmail}
                  onChange={e => {
                    setGithubOwnerEmail(e.target.value);
                    localStorage.setItem('vicious_github_owner_email', e.target.value);
                  }}
                  className="bg-card/80 border-white/10"
                />
              </div>

              <div className="space-y-2 border border-white/10 rounded-md p-3 bg-card/40">
                <label className="text-xs text-muted-foreground">GitHub Sign-In</label>
                {githubToken ? (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-green-400">Connected</span>
                    <Button size="sm" variant="outline" onClick={() => {
                      setGithubToken('');
                      localStorage.removeItem('vicious_github_token');
                    }}>Disconnect</Button>
                  </div>
                ) : (
                  <Button size="sm" onClick={async () => {
                    const state = Math.random().toString(36).substring(2);
                    const authUrl = `https://github.com/login/oauth/authorize?client_id=Ov23li0qvIjETm1hV8E8&scope=repo&redirect_uri=https://vicious-backend.vercel.app/api/github/callback&state=${state}`;
                    await Browser.open({ url: authUrl });
                  }}>Sign in with GitHub</Button>
                )}
              </div>

              <div className="space-y-2 border border-white/10 rounded-md p-3 bg-card/40">
                <label className="text-xs text-muted-foreground">Linked Repos (build history only — nothing is executed)</label>
                <div className="flex gap-2">
                  <Input
                    placeholder="owner/repo"
                    value={newRepoInput}
                    onChange={e => setNewRepoInput(e.target.value)}
                    className="bg-card/80 border-white/10"
                  />
                  <Button size="sm" onClick={addLinkedRepo}>Add</Button>
                </div>
                {linkedRepos.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {linkedRepos.map(r => (
                      <div key={r} className="flex items-center gap-1 text-xs bg-card/80 border border-white/10 rounded-full px-3 py-1">
                        <span>{r}</span>
                        <button onClick={() => removeLinkedRepo(r)} className="text-muted-foreground hover:text-destructive">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2 border border-white/10 rounded-md p-3 bg-card/40">
                <label className="text-xs text-muted-foreground">Save Current Session</label>
                <select
                  value={selectedSaveRepo}
                  onChange={e => setSelectedSaveRepo(e.target.value)}
                  className="w-full bg-card/80 border border-white/10 rounded-md text-sm p-2"
                >
                  <option value="">No repo</option>
                  {linkedRepos.map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
                <textarea
                  placeholder="Details for this session (notes, environment, deploy steps, etc. — no passwords)"
                  value={saveDetailsInput}
                  onChange={e => setSaveDetailsInput(e.target.value)}
                  className="bg-card/80 border border-white/10 rounded-md w-full text-xs p-2 h-20"
                />
                <Button size="sm" onClick={saveCurrentSession}>Save Current Session</Button>
              </div>

              {getSavedConversations().length === 0 ? (
                <p className="text-xs text-muted-foreground">No saved sessions yet.</p>
              ) : (
                getSavedConversations().map(conv => (
                  <div key={conv.id} className="bg-card/80 border border-white/10 rounded-md p-3 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">{conv.repo || 'Untitled Session'}</span>
                      <span className="text-[10px] text-muted-foreground">{new Date(conv.updatedAt).toLocaleString()}</span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{conv.title}</p>
                    <div className="flex gap-2 pt-1">
                      <Button size="sm" variant="outline" onClick={() => loadSession(conv)}>Load</Button>
                      <Button size="sm" variant="outline" onClick={() => setExpandedSessionId(expandedSessionId === conv.id ? null : conv.id)}>
                        {expandedSessionId === conv.id ? 'Hide Details' : 'Details'}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => deleteSession(conv.id)}>Delete</Button>
                    </div>
                    {expandedSessionId === conv.id && (
                      <div className="mt-2 text-xs bg-card/60 border border-white/10 rounded-md p-2 space-y-1">
                        <p><span className="text-muted-foreground">Repo:</span> {conv.repo || 'None'}</p>
                        <p className="whitespace-pre-wrap"><span className="text-muted-foreground">Details:</span> {conv.details || sessionSummary || 'No details added.'}</p>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          ) : activeTab === 'system' ? (
            <div className="flex-1 p-6 space-y-4 overflow-y-auto min-h-0">
              <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Settings</h2>
              <div className="space-y-2 border border-white/10 rounded-md p-3 bg-card/40">
                <label className="text-xs text-muted-foreground">Credential Lock</label>
                {!pinCode ? (
                  <>
                    <p className="text-[11px] text-muted-foreground">Set a PIN to protect your API keys and GitHub token. They stay hidden until you enter it.</p>
                    <Input
                      type="password"
                      placeholder="Create a PIN"
                      value={pinSetupInput}
                      onChange={e => setPinSetupInput(e.target.value)}
                      className="bg-card/80 border-white/10"
                    />
                    <Button size="sm" onClick={() => {
                      if (pinSetupInput.trim()) {
                        localStorage.setItem('vicious_settings_pin', pinSetupInput.trim());
                        setPinCode(pinSetupInput.trim());
                        setIsCredentialsUnlocked(true);
                        setPinSetupInput('');
                      }
                    }}>Set PIN</Button>
                  </>
                ) : isCredentialsUnlocked ? (
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] text-muted-foreground">Credentials unlocked for this session.</p>
                    <Button size="sm" variant="outline" onClick={() => setIsCredentialsUnlocked(false)}>Lock</Button>
                  </div>
                ) : (
                  <>
                    <p className="text-[11px] text-muted-foreground">Enter your PIN to view or edit API keys and tokens.</p>
                    <Input
                      type="password"
                      placeholder="PIN"
                      value={pinInput}
                      onChange={e => setPinInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && pinInput === pinCode) {
                          setIsCredentialsUnlocked(true);
                          setPinInput('');
                        }
                      }}
                      className="bg-card/80 border-white/10"
                    />
                    <Button size="sm" onClick={() => {
                      if (pinInput === pinCode) {
                        setIsCredentialsUnlocked(true);
                        setPinInput('');
                      }
                    }}>Unlock</Button>
                  </>
                )}
              </div>
              {isCredentialsUnlocked ? (
<div className="space-y-2">
                <label className="text-xs text-muted-foreground">Groq API Key</label>
                <Input
                  type="password"
                  placeholder="gsk_..."
                  value={apiKey}
                  onChange={e => {
                    setApiKey(e.target.value);
                    localStorage.setItem('vicious_api_key', e.target.value);
                  }}
                  className="bg-card/80 border-white/10"
                />
              </div>
              ) : (
                <LockedField label="Groq API Key" />
              )}
              {isCredentialsUnlocked ? (
<div className="space-y-2">
                <label className="text-xs text-muted-foreground">OpenAI API Key (optional)</label>
                <Input
                  type="password"
                  placeholder="sk-..."
                  value={openaiKey}
                  onChange={e => {
                    setOpenaiKey(e.target.value);
                    localStorage.setItem('vicious_openai_key', e.target.value);
                  }}
                  className="bg-card/80 border-white/10"
                />
              </div>
              ) : (
                <LockedField label="OpenAI API Key" />
              )}
              {isCredentialsUnlocked ? (
<div className="space-y-2">
                <label className="text-xs text-muted-foreground">Anthropic API Key (optional)</label>
                <Input
                  type="password"
                  placeholder="sk-ant-..."
                  value={anthropicKey}
                  onChange={e => {
                    setAnthropicKey(e.target.value);
                    localStorage.setItem('vicious_anthropic_key', e.target.value);
                  }}
                  className="bg-card/80 border-white/10"
                />
              </div>
              ) : (
                <LockedField label="Anthropic API Key" />
              )}
              
              
              

              

              

              {/* Text size */}
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">Text Size</label>
                <div className="flex gap-2">
                  {(['small', 'medium', 'large', 'xlarge'] as TextSize[]).map(size => (
                    <Button
                      key={size}
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setTextSize(size)}
                      className={cn(
                        'flex-1 border-white/10 capitalize',
                        textSize === size ? 'bg-primary text-white border-primary' : 'bg-card/80'
                      )}
                    >
                      {size === 'xlarge' ? 'X-Large' : size}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Vocal responses */}
              <div className="flex items-center justify-between rounded-lg border border-white/10 bg-card/80 px-4 py-3">
                <div>
                  <p className="text-sm font-medium">Vocal Responses</p>
                  <p className="text-xs text-muted-foreground">Speak assistant replies aloud</p>
                </div>
                <Switch checked={vocalResponses} onCheckedChange={setVocalResponses} />
              </div>

              {/* Accessibility watcher status + diagnostic log */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-muted-foreground">Accessibility Watcher</label>
                  <div className="flex items-center gap-2">
                    {diagnosticLog.length > 0 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs text-muted-foreground hover:text-white"
                        onClick={async () => {
                          try { await VixAccessibility.clearLog(); } catch {}
                          setDiagnosticLog([]);
                        }}
                      >
                        Clear
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-muted-foreground hover:text-white"
                      onClick={refreshWatcherStatus}
                    >
                      <RefreshCw className={cn('w-3.5 h-3.5', diagnosticLoading && 'animate-spin')} />
                    </Button>
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-lg border border-white/10 bg-card/80 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className={cn('w-4 h-4', watcherEnabled ? 'text-primary' : 'text-muted-foreground')} />
                    <div>
                      <p className="text-sm font-medium">
                        {watcherEnabled === null ? 'Status unknown' : watcherEnabled ? 'Enabled' : 'Disabled'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Watches every foreground app for stalls; logs why and how to fix it
                      </p>
                    </div>
                  </div>
                  {!watcherEnabled && (
                    <Button
                      type="button"
                      size="sm"
                      className="bg-primary hover:bg-primary/90 shrink-0"
                      onClick={() => VixAccessibility.openSettings().catch(() => {})}
                    >
                      Enable
                    </Button>
                  )}
                </div>

                <ScrollArea className="h-64 rounded-lg border border-white/10 bg-card/80">
                  <div className="p-3 space-y-3">
                    {diagnosticLog.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No interventions logged yet.</p>
                    ) : (
                      diagnosticLog.map(entry => (
                        <div key={entry.id} className="text-xs border-b border-white/5 pb-3 last:border-0 last:pb-0 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-primary truncate">{entry.packageName}</span>
                            <span className="text-muted-foreground shrink-0 ml-2">
                              idle {Math.round(entry.idleMs / 1000)}s
                            </span>
                          </div>
                          <p className="text-muted-foreground">{new Date(entry.timestamp).toLocaleString()}</p>
                          {entry.typedReply && (
                            <p className="text-foreground/90">
                              <span className="text-muted-foreground">Typed: </span>
                              {entry.typedReply}
                            </p>
                          )}
                          {entry.diagnosis && (
                            <p className="text-yellow-300/90">
                              <span className="text-muted-foreground">Diagnosis: </span>
                              {entry.diagnosis}
                            </p>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </div>

              {/* Floating bubble */}
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">Floating Bubble</label>
                <div className="flex items-center justify-between rounded-lg border border-white/10 bg-card/80 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">
                      {overlayPermissionGranted === null
                        ? 'Status unknown'
                        : overlayPermissionGranted
                        ? 'Permission granted'
                        : 'Permission needed'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      A draggable bubble for quick commands without switching back to Vicious
                    </p>
                  </div>
                  {!overlayPermissionGranted && (
                    <Button
                      type="button"
                      size="sm"
                      className="bg-primary hover:bg-primary/90 shrink-0"
                      onClick={() => VixAccessibility.requestOverlayPermission().catch(() => {})}
                    >
                      Enable
                    </Button>
                  )}
                </div>
                {overlayPermissionGranted && (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full border-white/10"
                    disabled={bubbleBusy}
                    onClick={toggleBubble}
                  >
                    {bubbleBusy ? 'Working...' : bubbleActive ? 'Stop Bubble' : 'Start Bubble'}
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <>
              <ScrollArea className="flex-1 p-6" viewportRef={scrollRef}>
                <div className="max-w-4xl mx-auto space-y-6" style={{ paddingBottom: 'calc(8rem + env(safe-area-inset-bottom, 0px))' }}>
                  {messages.map(msg => (
                    <div
                    key={msg.id}
                    className={cn('flex gap-4', msg.role === 'user' ? 'flex-row-reverse' : 'flex-row')}
                    onTouchStart={() => {
                      longPressTimerRef.current = setTimeout(() => {
                        copyToClipboard(msg.content, msg.id);
                      }, 500);
                    }}
                    onTouchEnd={() => {
                      if (longPressTimerRef.current) {
                        clearTimeout(longPressTimerRef.current);
                        longPressTimerRef.current = null;
                      }
                    }}
                    onTouchCancel={() => {
                      if (longPressTimerRef.current) {
                        clearTimeout(longPressTimerRef.current);
                        longPressTimerRef.current = null;
                      }
                    }}
                  >
                      <div className={cn(
                        'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-1',
                        msg.role === 'assistant' ? 'bg-primary/20 text-primary border border-primary/30' :
                        msg.role === 'system' ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' :
                        'bg-muted/50 text-muted-foreground border border-white/5'
                      )}>
                        <Terminal className="w-4 h-4" />
                      </div>
                      <Card className={cn(
                        'relative p-4 border-white/5 max-w-[80%]',
                        msg.role === 'assistant' ? 'bg-[#1c2226] text-foreground' :
                        msg.role === 'system' ? 'bg-yellow-500/10 border-yellow-500/20 text-yellow-300 text-xs font-mono' :
                        'bg-primary/10 border-primary/20 text-white'
                      )}>
                        {copiedId === msg.id && (
                      <div className="absolute -top-2 -right-2 text-[9px] bg-primary text-white px-2 py-0.5 rounded-full shadow">
                        Copied
                      </div>
                    )}
                    {msg.role === 'assistant' ? renderMessageContent(msg.content) : msg.content}
                      
                        {msg.role === 'assistant' && (
                          <button
                            onClick={() => copyToClipboard(msg.content, msg.id)}
                            className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                          >
                            {copiedId === msg.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                            {copiedId === msg.id ? 'Copied' : 'Copy'}
                          </button>
                        )}
                      </Card>
                    </div>
                  ))}
                </div>
              </ScrollArea>

              {/* Input */}
              <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-background via-background/95 to-transparent" style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))', paddingRight: 'calc(1.5rem + env(safe-area-inset-right, 0px))' }}>
                <div className="max-w-4xl mx-auto mb-2 flex flex-wrap gap-2">
                  {attachedFiles.map((f, idx) => (
                    <div key={idx} className="flex items-center gap-1 text-xs bg-card/80 border border-white/10 rounded-full px-3 py-1">
                      <Paperclip className="w-3 h-3" />
                      <span>{f.name}{f.type === 'zip' && f.extractedFiles ? ` (${f.extractedFiles.length} files)` : ''}</span>
                    </div>
                  ))}
                </div>
                <div className="max-w-4xl mx-auto flex items-center gap-4">
                  <div className="relative flex-1 min-w-0">
                    <Textarea
                      placeholder="Execute command or query... (Shift+Enter for a new line)"
                      className="min-h-[70px] max-h-[160px] bg-card/80 border-white/10 pr-12 text-lg resize-y"
                      value={inputValue}
                      onChange={e => setInputValue(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleCommand(inputValue);
                        }
                      }}
                    />
                    <Button variant="ghost" size="icon" className="absolute right-2 bottom-2" onClick={() => handleCommand(inputValue)}>
                      <Search className="w-5 h-5" />
                    </Button>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".zip"
                    multiple
                    className="hidden"
                    onChange={handleFileUpload}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-14 w-14 rounded-full bg-card/80 border border-white/10"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Paperclip className="w-5 h-5" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function LockedField({ label }: { label: string }) {
  return (
    <div className="space-y-2">
      <label className="text-xs text-muted-foreground">{label}</label>
      <div className="bg-card/40 border border-white/10 rounded-md px-3 py-2 text-xs text-muted-foreground italic">
        Locked — enter your PIN above to view or edit
      </div>
    </div>
  );
}

function NavItem({ icon: Icon, active, onClick, count }: { icon: any; active: boolean; onClick: () => void; count?: number }) {
  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="icon"
        onClick={onClick}
        className={cn('w-12 h-12 rounded-xl', active ? 'bg-primary text-white' : 'text-muted-foreground hover:text-white')}
      >
        <Icon className="w-6 h-6" />
      </Button>
      {count !== undefined && count > 0 && (
        <span className="absolute -top-1 -right-1 w-5 h-5 bg-yellow-400 text-black text-[10px] font-bold rounded-full flex items-center justify-center">
          {count}
        </span>
      )}
    </div>
  );
}

// --- Markdown-ish rendering for assistant replies (bold, headers, lists, code blocks) ---

function CodeBlock({ language, code }: { language?: string; code: string }) {
  const [copied, setCopied] = React.useState(false);
  const handleCopy = async () => {
    try {
      // Strip a leading "$ " or "# " prompt marker from each line, if present,
      // so what gets pasted is a real, directly-runnable command rather than
      // something that fails on a stray prompt character.
      const cleaned = code
        .split('\n')
        .map(line => line.replace(/^\s*[$#]\s?/, ''))
        .join('\n');
      await navigator.clipboard.writeText(cleaned);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable — fail silently
    }
  };
  return (
    <div className="relative my-2 rounded-lg overflow-hidden border border-white/10 bg-black/60">
      <div className="flex items-center justify-between px-3 py-1.5 bg-white/5 text-[10px] uppercase tracking-wide text-muted-foreground">
        <span>{language || 'code'}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 hover:text-white transition-colors"
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="p-3 overflow-x-auto text-xs font-mono whitespace-pre-wrap break-words">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function renderInlineMarkdown(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let lastIndex = 0;
  let match;
  let key = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    const token = match[0];
    if (token.startsWith('**')) {
      parts.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else {
      parts.push(
        <code key={key++} className="px-1 py-0.5 rounded bg-white/10 text-xs font-mono">
          {token.slice(1, -1)}
        </code>
      );
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

function renderMarkdownBlock(text: string): React.ReactNode[] {
  const lines = text.split('\n');
  const nodes: React.ReactNode[] = [];
  let key = 0;
  let listBuffer: string[] = [];
  let listType: 'ul' | 'ol' | null = null;

  const flushList = () => {
    if (listBuffer.length === 0) return;
    if (listType === 'ol') {
      nodes.push(
        <ol key={key++} className="list-decimal list-inside space-y-1 my-1">
          {listBuffer.map((item, i) => <li key={i}>{renderInlineMarkdown(item)}</li>)}
        </ol>
      );
    } else {
      nodes.push(
        <ul key={key++} className="list-disc list-inside space-y-1 my-1">
          {listBuffer.map((item, i) => <li key={i}>{renderInlineMarkdown(item)}</li>)}
        </ul>
      );
    }
    listBuffer = [];
    listType = null;
  };

  for (const line of lines) {
    const headerMatch = line.match(/^(#{1,4})\s+(.*)/);
    const olMatch = line.match(/^\s*\d+[.)]\s+(.*)/);
    const ulMatch = line.match(/^\s*[-*]\s+(.*)/);

    if (headerMatch) {
      flushList();
      const level = headerMatch[1].length;
      nodes.push(
        <div key={key++} className={cn(level <= 2 ? 'text-sm font-bold' : 'text-xs font-bold', 'mt-2 mb-1 text-primary')}>
          {renderInlineMarkdown(headerMatch[2])}
        </div>
      );
    } else if (olMatch) {
      if (listType !== 'ol') flushList();
      listType = 'ol';
      listBuffer.push(olMatch[1]);
    } else if (ulMatch) {
      if (listType !== 'ul') flushList();
      listType = 'ul';
      listBuffer.push(ulMatch[1]);
    } else if (line.trim() === '') {
      flushList();
      nodes.push(<div key={key++} className="h-1" />);
    } else {
      flushList();
      nodes.push(<p key={key++} className="my-0.5">{renderInlineMarkdown(line)}</p>);
    }
  }
  flushList();
  return nodes;
}

function renderMessageContent(content: string): React.ReactNode {
  const parts = content.split(/```(\w*)\n?([\s\S]*?)```/g);
  const nodes: React.ReactNode[] = [];
  let key = 0;
  for (let i = 0; i < parts.length; i += 3) {
    const textPart = parts[i];
    if (textPart) nodes.push(<div key={key++}>{renderMarkdownBlock(textPart)}</div>);
    const lang = parts[i + 1];
    const code = parts[i + 2];
    if (code !== undefined) {
      nodes.push(<CodeBlock key={key++} language={lang} code={code.replace(/\n$/, '')} />);
    }
  }
  return nodes;
}
