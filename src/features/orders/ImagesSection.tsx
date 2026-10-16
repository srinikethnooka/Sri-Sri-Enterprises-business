import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Eye, EyeOff, ImagePlus, Trash2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { fmtDate } from '@/lib/format';
import { useBusinessId, useSession } from '@/app/session';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState } from '@/components/ui/misc';
import { useToast } from '@/components/ui/Toast';
import type { Order } from '@/types/models';

type EntityType = 'order' | 'customer';
interface Att { id: string; path: string; visibility: 'customer' | 'internal'; caption: string | null; created_by: string | null; created_at: string }

/** Downscales large photos in the browser before upload (keeps storage and mobile data small). */
export async function shrink(file: File, max = 1600): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  if (s === 1 && file.size < 1_500_000) return file;
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return await new Promise((res) => c.toBlob((b) => res(b ?? file), 'image/jpeg', 0.85));
}

const folder = (bid: string, type: EntityType, id: string) => (type === 'order' ? `${bid}/${id}` : `${bid}/customers/${id}`);

/**
 * Saves photos to private Supabase Storage and records them in the database
 * (attachments table), so they show every time the order or customer is opened.
 */
export async function uploadPhotos(bid: string, type: EntityType, id: string, files: File[], caption?: string) {
  let saved = 0;
  for (const f of files.slice(0, 20)) {
    if (!f.type.startsWith('image/')) throw new Error(`${f.name}: only photos can be added`);
    if (f.size > 15_000_000) throw new Error(`${f.name}: photo is too large (max 15 MB)`);
    const blob = await shrink(f);
    const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
    const path = `${folder(bid, type, id)}/${crypto.randomUUID()}.${ext}`;
    const up = await supabase.storage.from('order-images').upload(path, blob, { contentType: blob.type || 'image/jpeg' });
    if (up.error) throw up.error;
    const ins = await supabase.from('attachments').insert({
      business_id: bid, bucket: 'order-images', path, entity_type: type, entity_id: id,
      visibility: 'internal', mime: blob.type, size_bytes: blob.size, caption: caption ?? null,
    });
    if (ins.error) {
      await supabase.storage.from('order-images').remove([path]);
      throw ins.error;
    }
    saved++;
  }
  return saved;
}

/** Photo gallery for an order or a customer: add, view full size, hide/show to customer, delete. */
export function PhotosCard({ entityType, entityId, title, emptyText, allowCustomerVisible }: {
  entityType: EntityType; entityId: string; title: string; emptyText: string; allowCustomerVisible?: boolean;
}) {
  const bid = useBusinessId();
  const { can, session, isOwner } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<(Att & { url: string | null }) | null>(null);
  const key = ['photos', entityType, entityId];

  const q = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase.from('attachments').select('id, path, visibility, caption, created_by, created_at')
        .eq('entity_type', entityType).eq('entity_id', entityId).eq('bucket', 'order-images').order('created_at');
      if (error) throw error;
      const rows = data as Att[];
      if (!rows.length) return [];
      const signed = await supabase.storage.from('order-images').createSignedUrls(rows.map((r) => r.path), 3600);
      return rows.map((r, i) => ({ ...r, url: signed.data?.[i]?.signedUrl ?? null }));
    },
  });

  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      const n = await uploadPhotos(bid, entityType, entityId, Array.from(files));
      qc.invalidateQueries({ queryKey: key });
      toast.success(n === 1 ? 'Photo saved' : `${n} photos saved`);
    } catch (e) {
      toast.error(e instanceof Error && !('code' in e) ? e.message : errorMessage(e));
    } finally {
      setBusy(false);
      if (camera.current) camera.current.value = '';
      if (picker.current) picker.current.value = '';
    }
  };

  const toggle = useMutation({
    mutationFn: async (a: Att) => {
      const { error } = await supabase.from('attachments').update({ visibility: a.visibility === 'customer' ? 'internal' : 'customer' }).eq('id', a.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const del = useMutation({
    mutationFn: async (a: Att) => {
      const r = await supabase.from('attachments').delete().eq('id', a.id);
      if (r.error) throw r.error;
      await supabase.storage.from('order-images').remove([a.path]);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); setViewing(null); toast.success('Photo deleted'); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Card title={title} actions={<>
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => add(e.target.files)} />
      <input ref={picker} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => add(e.target.files)} />
      <Button size="sm" variant="secondary" icon={<Camera className="h-4 w-4" />} loading={busy} onClick={() => camera.current?.click()}>Camera</Button>
      <Button size="sm" variant="secondary" icon={<ImagePlus className="h-4 w-4" />} disabled={busy} onClick={() => picker.current?.click()}>Add photos</Button>
    </>}>
      {q.data?.length ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
          {q.data.map((a) => (
            <figure key={a.id} className="overflow-hidden rounded-lg border border-cream-300 bg-cream-50">
              <button className="block w-full" onClick={() => setViewing(a)} aria-label="Open photo">
                {a.url ? <img src={a.url} alt={a.caption ?? 'Photo'} className="aspect-square w-full object-cover" loading="lazy" /> : <div className="aspect-square" />}
              </button>
              {(allowCustomerVisible || a.caption) && (
                <figcaption className="truncate px-1.5 py-1 text-[11px] text-ink-500">
                  {a.caption ?? (a.visibility === 'customer' ? 'Customer can see' : 'Team only')}
                </figcaption>
              )}
            </figure>
          ))}
        </div>
      ) : <EmptyState title="No photos yet" body={emptyText} />}

      {viewing && (
        <div className="fixed inset-0 z-50 flex flex-col bg-ink-900/90 p-3" role="dialog" aria-modal="true" aria-label="Photo">
          <div className="mb-2 flex items-center justify-between gap-2 text-sm text-white">
            <span>{viewing.caption ?? fmtDate(viewing.created_at)}</span>
            <div className="flex gap-1">
              {allowCustomerVisible && can('orders.manage') && (
                <button className="flex items-center gap-1 rounded-lg bg-white/10 px-3 py-2 hover:bg-white/20" onClick={() => toggle.mutate(viewing, { onSuccess: () => setViewing({ ...viewing, visibility: viewing.visibility === 'customer' ? 'internal' : 'customer' }) })}>
                  {viewing.visibility === 'customer' ? <><EyeOff className="h-4 w-4" /> Hide from customer</> : <><Eye className="h-4 w-4" /> Show to customer</>}
                </button>
              )}
              {(isOwner || viewing.created_by === session?.user.id) && (
                <button className="flex items-center gap-1 rounded-lg bg-white/10 px-3 py-2 hover:bg-white/20" onClick={() => del.mutate(viewing)}><Trash2 className="h-4 w-4" /> Delete</button>
              )}
              <button className="rounded-lg bg-white/10 p-2 hover:bg-white/20" onClick={() => setViewing(null)} aria-label="Close"><X className="h-5 w-5" /></button>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center" onClick={() => setViewing(null)}>
            {viewing.url && <img src={viewing.url} alt="" className="max-h-full max-w-full rounded-lg object-contain" onClick={(e) => e.stopPropagation()} />}
          </div>
        </div>
      )}
    </Card>
  );
}

export function ImagesSection({ order }: { order: Order }) {
  return (
    <PhotosCard entityType="order" entityId={order.id} title="Design photos" allowCustomerVisible
      emptyText="Add reference designs, fabric, the bill photo or the finished garment. Photos are private until you choose “Show to customer”." />
  );
}
