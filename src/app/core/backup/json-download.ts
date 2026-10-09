import { DOCUMENT } from '@angular/common';
import { inject, Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class JsonDownload {
  private readonly document = inject(DOCUMENT);
  download(value: unknown, filename: string): void {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' }),
    );
    const link = this.document.createElement('a');
    link.href = url;
    link.download = filename;
    try {
      this.document.body.append(link);
      link.click();
    } finally {
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
}
