/** Hand a text file to the user: share sheet on phones, plain download on PCs. */

function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Phones: the share sheet (iPhone: 「ファイルに保存」/AirDrop), because a home-screen web app on
 * iOS cannot save downloads reliably. PCs keep the plain download. Chrome only shares
 * allow-listed MIME types, so text/plain is tried when `type` is refused.
 */
export async function exportFile(
  name: string,
  text: string,
  type: string,
): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const touch = window.matchMedia('(pointer: coarse)').matches;
  if (touch && typeof navigator.canShare === 'function') {
    for (const t of [type, 'text/plain']) {
      const file = new File([text], name, { type: t });
      if (!navigator.canShare({ files: [file] })) continue;
      try {
        await navigator.share({ files: [file], title: name });
        return 'shared';
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
        console.warn('share failed; falling back to download', e);
        break;
      }
    }
  }
  download(name, text, type);
  return 'downloaded';
}
