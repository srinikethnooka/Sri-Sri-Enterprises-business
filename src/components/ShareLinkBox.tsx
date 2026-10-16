import { useState } from 'react';
import { Copy, MessageCircle, Check } from 'lucide-react';
import { Button } from './ui/Button';
import { whatsappUrl } from '@/lib/whatsapp';

/** Shows a one-time link with Copy and Open-WhatsApp buttons. */
export function ShareLinkBox({ url, message, phone }: { url: string; message: string; phone?: string | null }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-3">
      <div className="break-all rounded-lg border border-cream-300 bg-cream-50 p-3 font-mono text-xs">{url}</div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" icon={copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          onClick={async () => { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
          {copied ? 'Copied' : 'Copy link'}
        </Button>
        {phone && (
          <Button variant="gold" icon={<MessageCircle className="h-4 w-4" />}
            onClick={() => window.open(whatsappUrl(phone, message), '_blank', 'noopener,noreferrer')}>
            Open WhatsApp
          </Button>
        )}
      </div>
      <p className="text-xs text-ink-500">This link is shown only once. Anyone with it can use it, so send it only to the right person.</p>
    </div>
  );
}
