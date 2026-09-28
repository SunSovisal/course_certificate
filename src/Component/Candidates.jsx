import { useLayoutEffect, useRef, useState } from 'react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import Header from './header.jsx';
import Template from './template.jsx';
import Footer from './footer.jsx'

function isIOS() {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function certificateFileName(name) {
  const safe = String(name).replace(/[\\/:*?"<>|]+/g, '').trim();
  return `Certificate-${safe || 'student'}.pdf`;
}

async function waitForImages(root) {
  const images = [...root.querySelectorAll('img')];
  await Promise.all(images.map(async (img) => {
    if (img.decode) {
      try {
        await img.decode();
        return;
      } catch {
        return;
      }
    }
    if (img.complete) return;
    await new Promise((resolve) => {
      img.onload = resolve;
      img.onerror = resolve;
    });
  }));

  const background = getComputedStyle(root).backgroundImage;
  const match = background.match(/url\(["']?(.*?)["']?\)/);
  if (!match?.[1] || match[1] === 'none') return;
  await new Promise((resolve) => {
    const image = new Image();
    image.onload = resolve;
    image.onerror = resolve;
    image.src = match[1];
  });
}

async function captureCertificate(element) {
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;overflow:hidden;z-index:-1;pointer-events:none;';

  const clone = element.cloneNode(true);
  clone.style.transform = 'none';
  clone.style.margin = '0';
  clone.style.width = `${element.offsetWidth}px`;
  clone.style.height = `${element.offsetHeight}px`;
  host.appendChild(clone);
  document.body.appendChild(host);

  try {
    if (document.fonts?.ready) await document.fonts.ready;
    await waitForImages(clone);

    let lastError;
    for (const scale of [2, 1]) {
      try {
        const canvas = await html2canvas(clone, {
          scale,
          useCORS: true,
          backgroundColor: '#ffffff',
          logging: false,
        });
        const image = canvas.toDataURL('image/jpeg', 0.95);
        if (!image || image.length < 1000) {
          throw new Error('Certificate image was empty');
        }
        return image;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  } finally {
    host.remove();
  }
}

export default function Candidate({ name }) {
  const frameRef = useRef(null);
  const certificateRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [readyFile, setReadyFile] = useState(null);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    const certificate = certificateRef.current;
    if (!frame || !certificate) return;

    const update = () => {
      const naturalWidth = certificate.offsetWidth;
      const naturalHeight = certificate.offsetHeight;
      const available = frame.clientWidth;
      if (!naturalWidth || !naturalHeight || !available) return;

      const nextScale = Math.min(1, available / naturalWidth);
      const scaler = frame.querySelector('.certificate-scaler');
      if (scaler) scaler.style.transform = `scale(${nextScale})`;
      frame.style.height = `${naturalHeight * nextScale}px`;
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(frame);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  const handleSave = async () => {
    if (!readyFile) return;
    try {
      await navigator.share({ files: [readyFile], title: readyFile.name });
      setReadyFile(null);
      setError('');
    } catch (shareError) {
      if (shareError?.name === 'AbortError') return;
      setError('The save menu could not open. Tap Save PDF again.');
    }
  };

  const handleDownloadPdf = async () => {
    const element = certificateRef.current;
    if (!element || busy) return;

    setBusy(true);
    setError('');
    setReadyFile(null);

    try {
      const image = await captureCertificate(element);
      const pdf = new jsPDF('landscape', 'mm', 'a4');
      pdf.setProperties({ title: `Certificate - ${name}` });
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      pdf.addImage(image, 'JPEG', 0, 0, pdfWidth, pdfHeight, undefined, 'FAST');

      const filename = certificateFileName(name);
      const blob = pdf.output('blob');
      const file = new File([blob], filename, { type: 'application/pdf' });

      if (isIOS() && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: filename });
          return;
        } catch (shareError) {
          if (shareError?.name === 'AbortError') return;
          setReadyFile(file);
          return;
        }
      }

      if (isIOS()) {
        setReadyFile(file);
        return;
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
    } catch (downloadError) {
      console.error(downloadError);
      setError('The PDF could not be created. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="preview-container">
      <div className="download-section">
        <h1 className="variant-title">Certificate for {name}</h1>
        <button
          type="button"
          className="download-btn"
          onClick={readyFile ? handleSave : handleDownloadPdf}
          disabled={busy}
          aria-busy={busy}
        >
          {busy ? 'Preparing PDF…' : readyFile ? 'Save PDF' : 'Download PDF'}
        </button>
      </div>
      {readyFile ? (
        <p className="download-hint">Tap Save PDF, then choose Save to Files.</p>
      ) : null}
      {error ? <p className="download-error" role="alert">{error}</p> : null}

      <div className="certificate-frame" ref={frameRef}>
        <div className="certificate-scaler">
          <section className="certificate" ref={certificateRef}>
            <div className="certificate-inner">
              <Header />
              <Template name={name} />
              <Footer/>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}