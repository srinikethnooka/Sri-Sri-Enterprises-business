import { supabase } from '@/lib/supabase';

export function logoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return supabase.storage.from('branding').getPublicUrl(path).data.publicUrl;
}

export function Brand({ name, logoPath, compact }: { name?: string | null; logoPath?: string | null; compact?: boolean }) {
  const url = logoUrl(logoPath);
  return (
    <div className="flex items-center gap-2.5">
      {url ? (
        <img src={url} alt="" className="h-9 w-9 rounded-lg object-contain" />
      ) : (
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-burgundy-700 font-display text-lg font-bold text-gold-100">SS</div>
      )}
      <span className={compact ? 'font-display text-lg font-bold text-burgundy-700' : 'font-display text-xl font-bold leading-tight text-burgundy-700'}>
        {name || 'Sri Sri Boutique'}
      </span>
    </div>
  );
}
