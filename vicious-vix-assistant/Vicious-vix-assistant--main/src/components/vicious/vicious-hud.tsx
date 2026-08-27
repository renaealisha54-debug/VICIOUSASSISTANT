"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Camera, MessageSquare, Bell, Settings, Terminal, Github, Phone, X, Search, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
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


async function askGroq(prompt: string, apiKey: string): Promise<string> {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'openai/gpt-oss-120b',
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? 'No response.';
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
  const [isListening, setIsListening] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [userName, setUserName] = useState('Operator');
  const [activeTab, setActiveTab] = useState<'chat' | 'reminders' | 'camera' | 'system'>('chat');
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [reminders, setReminders] = useState<{ id: string; text: string; time?: string; date?: string }[]>([]);
  const [apiKey, setApiKey] = useState('');
  const [textSize, setTextSize] = useState<TextSize>('medium');
  const [vocalResponses, setVocalResponses] = useState(false);
  const [activationLog, setActivationLog] = useState<ActivationLogEntry[]>([]);
  const [watcherEnabled, setWatcherEnabled] = useState<boolean | null>(null);
  const [diagnosticLog, setDiagnosticLog] = useState<VixDiagnosticEntry[]>([]);
  const [diagnosticLoading, setDiagnosticLoading] = useState(false);
  const { toast } = useToast();

  const scrollRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const savedName = localStorage.getItem('vicious_user_name');
    if (savedName) setUserName(savedName);

    const savedKey = localStorage.getItem('vicious_api_key');
    if (savedKey) setApiKey(savedKey);

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

    const savedReminders = localStorage.getItem('vicious_reminders');
    if (savedReminders) setReminders(JSON.parse(savedReminders));

    const savedTextSize = localStorage.getItem('vicious_text_size') as TextSize | null;
    if (savedTextSize) setTextSize(savedTextSize);

    const savedVocal = localStorage.getItem('vicious_vocal_responses');
    if (savedVocal) setVocalResponses(savedVocal === 'true');

    const savedLog = localStorage.getItem('vicious_activation_log');
    if (savedLog) setActivationLog(JSON.parse(savedLog));
  }, []);

  useEffect(() => {
    localStorage.setItem('vicious_history', JSON.stringify(messages));
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    localStorage.setItem('vicious_reminders', JSON.stringify(reminders));
  }, [reminders]);

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

  // Refresh watcher status/log whenever the Settings tab is opened
  useEffect(() => {
    if (activeTab === 'system') {
      refreshWatcherStatus();
    }
  }, [activeTab]);

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

  /** Returns a short confirmation message if it handled the command, or null if not. */
  const tryDeviceAction = (text: string): string | null => {
    const lower = text.toLowerCase().trim();

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

    // "github" / "repo" — opens the real site (no fake sync claims)
    if (lower.includes('github') || lower.includes('repo')) {
      openSystem('https://github.com');
      return 'Opening GitHub in your browser...';
    }

    // "open <url or site>" / "go to <url or site>"
    const openMatch = text.match(/^(?:open|go to)\s+(.+)/i);
    if (openMatch) {
      const target = openMatch[1].trim();
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

  const handleCommand = async (text: string, source: 'voice' | 'text' = 'text') => {
    if (!text.trim()) return;
    addMessage('user', text);
    setInputValue('');
    logActivation(source, text);

    // Device actions run even without an API key — they don't call the LLM
    const deviceResult = tryDeviceAction(text);
    if (deviceResult) {
      addMessage('assistant', deviceResult);
      return;
    }

    if (!apiKey) {
      addMessage('system', 'API key not set. Go to Settings and enter your Groq key.');
      return;
    }

    const lowerText = text.toLowerCase();

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
        const response = await askGroq(
          `You are Vicious Assistant, a sleek AI. Answer concisely: ${text}`,
          apiKey
        );
        addMessage('assistant', response);
      }
    } catch (e: any) {
      addMessage('system', `Error: ${e.message}`);
    }
  };

  const startListening = () => {
    if (!('webkitSpeechRecognition' in window)) {
      toast({ title: 'Speech recognition not supported in this browser.', variant: 'destructive' });
      return;
    }
    const recognition = new (window as any).webkitSpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onresult = (event: any) => handleCommand(event.results[0][0].transcript, 'voice');
    recognition.start();
  };

  const captureImage = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    const context = canvasRef.current.getContext('2d');
    if (!context) return;
    canvasRef.current.width = videoRef.current.videoWidth;
    canvasRef.current.height = videoRef.current.videoHeight;
    context.drawImage(videoRef.current, 0, 0);
    const dataUri = canvasRef.current.toDataURL('image/jpeg');
    setIsCameraOpen(false);
    addMessage('user', 'Analyzing captured image...', 'image');
    try {
      const base64 = dataUri.split(',')[1];
      const res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'qwen/qwen3.6-27b',
          messages: [{
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
              { type: 'text', text: 'Describe this image concisely as Vicious Assistant.' },
            ],
          }],
        }),
      });
      const data = await res.json();
      addMessage('assistant', data.choices?.[0]?.message?.content ?? 'Could not analyze image.');
    } catch (error) {
      addMessage('system', 'Error analyzing image context.');
    }
  };

  const openCamera = async () => {
    setIsCameraOpen(true);
    setActiveTab('camera');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch {
      toast({ title: 'Camera permission denied', variant: 'destructive' });
      setIsCameraOpen(false);
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
          <NavItem icon={Bell} active={activeTab === 'reminders'} onClick={() => setActiveTab('reminders')} count={reminders.length} />
          <NavItem icon={Camera} active={activeTab === 'camera'} onClick={openCamera} />
          <NavItem icon={Settings} active={activeTab === 'system'} onClick={() => setActiveTab('system')} />
        </nav>

        {/* Main */}
        <main className="flex-1 flex flex-col relative">
          {activeTab === 'system' ? (
            <div className="flex-1 p-6 space-y-4">
              <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Settings</h2>
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
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">Operator Name</label>
                <Input
                  placeholder="Operator"
                  value={userName}
                  onChange={e => {
                    setUserName(e.target.value);
                    localStorage.setItem('vicious_user_name', e.target.value);
                  }}
                  className="bg-card/80 border-white/10"
                />
              </div>

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
                  </div>
                </ScrollArea>
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
            </div>
          ) : (
            <>
              <ScrollArea className="flex-1 p-6" viewportRef={scrollRef}>
                <div className="max-w-4xl mx-auto space-y-6 pb-24">
                  {messages.map(msg => (
                    <div key={msg.id} className={cn('flex gap-4', msg.role === 'user' ? 'flex-row-reverse' : 'flex-row')}>
                      <div className={cn(
                        'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-1',
                        msg.role === 'assistant' ? 'bg-primary/20 text-primary border border-primary/30' :
                        msg.role === 'system' ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' :
                        'bg-muted/50 text-muted-foreground border border-white/5'
                      )}>
                        <Terminal className="w-4 h-4" />
                      </div>
                      <Card className={cn(
                        'p-4 border-white/5 max-w-[80%]',
                        msg.role === 'assistant' ? 'bg-[#1c2226] text-foreground' :
                        msg.role === 'system' ? 'bg-yellow-500/10 border-yellow-500/20 text-yellow-300 text-xs font-mono' :
                        'bg-primary/10 border-primary/20 text-white'
                      )}>
                        {msg.content}
                      </Card>
                    </div>
                  ))}
                </div>
              </ScrollArea>

              {/* Listening overlay */}
              {isListening && (
                <div className="absolute inset-0 bg-background/80 backdrop-blur-xl z-50 flex flex-col items-center justify-center">
                  <div className="w-32 h-32 rounded-full bg-primary/20 flex items-center justify-center">
                    <Mic className="w-16 h-16 text-primary" />
                  </div>
                  <h2 className="text-3xl font-bold mt-8 text-white tracking-widest uppercase">Listening</h2>
                  <Button variant="outline" className="mt-12" onClick={() => setIsListening(false)}>Cancel</Button>
                </div>
              )}

              {/* Camera overlay */}
              {isCameraOpen && (
                <div className="absolute inset-0 bg-black z-50 flex flex-col items-center justify-center">
                  <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
                  <canvas ref={canvasRef} className="hidden" />
                  <Button className="absolute top-6 right-6" variant="ghost" size="icon" onClick={() => setIsCameraOpen(false)}>
                    <X className="w-6 h-6 text-white" />
                  </Button>
                  <Button className="absolute bottom-12 w-20 h-20 rounded-full bg-white" onClick={captureImage} />
                </div>
              )}

              {/* Input */}
              <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-background via-background/95 to-transparent">
                <div className="max-w-4xl mx-auto flex items-center gap-4">
                  <div className="relative flex-1">
                    <Input
                      placeholder="Execute command or query..."
                      className="h-14 bg-card/80 border-white/10 pr-12 text-lg"
                      value={inputValue}
                      onChange={e => setInputValue(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleCommand(inputValue)}
                    />
                    <Button variant="ghost" size="icon" className="absolute right-2 top-1/2 -translate-y-1/2" onClick={() => handleCommand(inputValue)}>
                      <Search className="w-5 h-5" />
                    </Button>
                  </div>
                  <Button
                    onClick={startListening}
                    className={cn('h-14 w-14 rounded-full', isListening ? 'bg-destructive hover:bg-destructive/90' : 'bg-primary hover:bg-primary/90')}
                  >
                    {isListening ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
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
