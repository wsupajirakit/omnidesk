/**
 * [FIX-20260818-UPLOADFILTER] plan §2.4 B1 = T1-3 of fix_plan_18_aug · closes C6 leg 2
 *
 * The two upload routes stored `extname(file.originalname)` verbatim, with no
 * fileFilter and without reading `mimetype`, so `evil.html` landed in the public
 * uploads directory under its own extension. The serve side has always limited
 * itself to five extensions, which is the whole argument for safety here: a file
 * this filter now refuses is a file that could never have been fetched back
 * through the normal path anyway.
 *
 * BEFORE rows (real images) must keep passing — a filter that rejects a genuine
 * upload is worse than the hole. AFTER rows are what used to be written to disk.
 */
import { HttpException } from '@nestjs/common';

import { IMAGE_MIME } from '@/infra/static/hardened-image-serve.middleware';
import { imageUploadFilter } from '@/infra/static/image-upload-filter';
import { videoUploadFilter } from '@/infra/static/video-upload-filter';

const run = (originalname: string, mimetype: string) => {
  // typed as unknown so TS does not narrow it to `never` before the callback runs
  let error: unknown = null;
  let accepted: boolean | undefined;
  imageUploadFilter({}, { originalname, mimetype }, (e, ok) => {
    error = e;
    accepted = ok;
  });
  return { error, accepted };
};

describe('[UPLOADFILTER] real images still upload', () => {
  it.each([
    ['photo.png', 'image/png'],
    ['photo.PNG', 'image/png'],
    ['slip.jpg', 'image/jpeg'],
    ['slip.jpeg', 'image/jpeg'],
    ['anim.gif', 'image/gif'],
    ['shot.webp', 'image/webp'],
    // browsers and older clients send this non-standard type for .jpg
    ['legacy.jpg', 'image/jpg'],
  ])('%s (%s) is accepted', (name, mime) => {
    const { error, accepted } = run(name, mime);
    expect(error).toBeNull();
    expect(accepted).toBe(true);
  });
});

describe('[UPLOADFILTER] what used to reach disk is refused', () => {
  it.each([
    ['evil.html', 'text/html'],
    ['evil.svg', 'image/svg+xml'], // scriptable, and not served either
    ['shell.php', 'application/x-httpd-php'],
    ['payload.js', 'text/javascript'],
    ['archive.zip', 'application/zip'],
    ['noext', 'image/png'],
  ])('⭐ %s (%s) is rejected', (name, mime) => {
    const { error, accepted } = run(name, mime);
    expect(accepted).toBe(false);
    expect(error).toBeInstanceOf(Error);
  });

  it('⭐ a mismatched pair is rejected even when the extension is allowed', () => {
    // `originalname` and `mimetype` are BOTH attacker-controlled, so neither is
    // trusted alone — they have to agree with the same table.
    expect(run('evil.png', 'text/html').accepted).toBe(false);
    expect(run('evil.jpg', 'application/octet-stream').accepted).toBe(false);
  });

  /**
   * ⚠️ HONEST NOTE ON A SURVIVING MUTATION. Neutralising the extension check
   * leaves every case here green, and after chasing it the reason is that the
   * check is genuinely REDUNDANT rather than untested: `declared` is
   * `(file.mimetype || '')`, so it is `''` — never `undefined` — and `'' ===
   * undefined` is false, so the MIME comparison alone already rejects everything
   * the extension check would. That makes it an equivalent mutant, not a gap.
   *
   * The extension check is kept for two reasons that a test cannot express: it
   * exits early with an error naming the accepted types, and it states the rule
   * where a reader looks for it. This case pins the input that comes closest to
   * separating them — neither an extension nor a declared type — so the pair's
   * combined behaviour is at least locked down. ไม่ใช่เทสอ่อน แต่โค้ดสองชั้นทับกันจริง
   */
  it('⭐ no extension AND no declared type is rejected', () => {
    let error: unknown = null;
    let accepted: boolean | undefined;
    imageUploadFilter({}, { originalname: 'noext' }, (e, ok) => {
      error = e;
      accepted = ok;
    });
    expect(accepted).toBe(false);
    expect(error).toBeInstanceOf(Error);
  });

  it('the error names the accepted types and never a path', () => {
    const { error } = run('/etc/passwd', 'text/plain');
    expect(String((error as Error)?.message)).toContain('.png');
    expect(String((error as Error)?.message)).not.toContain('/etc');
  });
});

/**
 * [FIX-20260904-UPLOAD400] The refusal CONTRACT — one shape for every family.
 * ===========================================================================
 * Owner, 04/09: a wrong file must answer 400 and say which extensions are
 * accepted. Before this, both filters threw a plain `Error`; Nest's multer
 * bridge forwards anything that is not an `HttpException` untouched, so the
 * catch-all filter answered `500 {"error":"internal error"}` — the admin was
 * told the SERVER broke. เลือกไฟล์ผิด = ต้องตอบ 4xx และบอกว่ารับสกุลอะไร
 *
 * Both families are asserted HERE, together, on purpose: the status and the
 * sentence are ONE contract, and a test per file is how the two drift apart.
 */
describe('[UPLOAD400] a refused upload answers 400 and names what is allowed', () => {
  const refuse = (
    filter: typeof imageUploadFilter,
    name: string,
    mime: string,
  ): HttpException => {
    let error: unknown = null;
    filter({}, { originalname: name, mimetype: mime }, (e) => {
      error = e;
    });
    return error as HttpException;
  };

  it('🔴 the image refusal is an HttpException with status 400', () => {
    /* 🔴 MUTATION KILLER. A plain `Error` here is exactly the old bug, and it
       is invisible to every other case in this file — they only check that the
       upload was refused, which it always was. */
    const error = refuse(imageUploadFilter, 'evil.html', 'text/html');
    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(400);
  });

  it('🔴 the video refusal is an HttpException with status 400', () => {
    const error = refuse(videoUploadFilter, 'clip.mov', 'video/quicktime');
    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(400);
  });

  it('the image message lists every accepted extension, and no path', () => {
    const error = refuse(imageUploadFilter, '/etc/passwd', 'text/plain');
    for (const ext of Object.keys(IMAGE_MIME)) {
      expect(error.message).toContain(ext);
    }
    expect(error.message).not.toContain('/etc');
  });

  it('🔴 the video message lists .mp4 and NOT the image extensions', () => {
    /* 🔴 MUTATION KILLER for the shared gate: if the two families were ever
       handed the same table — the exact mistake sharing code could introduce —
       this goes red while every "is it refused" case stays green.
       ห้ามปนกับรูป: พิสูจน์ที่ข้อความด้วย ไม่ใช่แค่ที่โฟลเดอร์ */
    const error = refuse(videoUploadFilter, 'clip.mov', 'video/quicktime');
    expect(error.message).toContain('.mp4');
    expect(error.message).not.toContain('.png');
    expect(error.message).not.toContain('.jpg');
  });

  it('each family reports its own error name — the status cannot say which', () => {
    expect(refuse(imageUploadFilter, 'a.bmp', 'image/bmp').name).toBe(
      'UnsupportedImageTypeError',
    );
    expect(refuse(videoUploadFilter, 'a.mov', 'video/quicktime').name).toBe(
      'UnsupportedVideoTypeError',
    );
  });

  it('🔴 an ACCEPTED file still passes with no error — the gate did not close', () => {
    /* Guards the direction nobody watches after a refusal change: every case
       above proves things are refused. This one proves the rest still get in,
       on BOTH families. */
    let imgErr: unknown = 'untouched';
    imageUploadFilter(
      {},
      { originalname: 'ok.png', mimetype: 'image/png' },
      (e, ok) => {
        imgErr = e;
        expect(ok).toBe(true);
      },
    );
    expect(imgErr).toBeNull();

    let vidErr: unknown = 'untouched';
    videoUploadFilter(
      {},
      { originalname: 'ok.mp4', mimetype: 'video/mp4' },
      (e, ok) => {
        vidErr = e;
        expect(ok).toBe(true);
      },
    );
    expect(vidErr).toBeNull();
  });
});

/**
 * [FIX-20260904-UPLOAD400] The sentence has to match the actual problem.
 *
 * Found live while proving the 400 on the stack: an `.mp4` announced as
 * `text/html` produced "Unsupported video type: .mp4. Allowed: .mp4" — the
 * extension IS allowed, so the admin read a contradiction and had nothing to
 * act on. The two refusals are different problems and now read differently.
 */
describe('[UPLOAD400] extension refusal vs content-type mismatch', () => {
  const messageFor = (
    filter: typeof imageUploadFilter,
    name: string,
    mime: string,
  ): string => {
    let error: unknown = null;
    filter({}, { originalname: name, mimetype: mime }, (e) => {
      error = e;
    });
    return (error as Error).message;
  };

  it('🔴 an ALLOWED extension with a wrong content type does not claim the extension is unsupported', () => {
    /* 🔴 MUTATION KILLER. Collapsing the two reasons back into one message
       brings the contradiction straight back, and every other case here stays
       green because the status and the allowed list are unchanged. */
    const msg = messageFor(videoUploadFilter, 'clip.mp4', 'text/html');
    expect(msg).not.toContain('Unsupported video type');
    expect(msg).toContain('does not match');
    expect(msg).toContain('.mp4');
  });

  it('an extension that is not on the table still says "unsupported"', () => {
    expect(
      messageFor(videoUploadFilter, 'clip.mov', 'video/quicktime'),
    ).toContain('Unsupported video type');
  });

  it('the image family gets the same treatment, from the same code', () => {
    expect(messageFor(imageUploadFilter, 'photo.png', 'text/html')).toContain(
      'does not match',
    );
    expect(messageFor(imageUploadFilter, 'photo.bmp', 'image/bmp')).toContain(
      'Unsupported image type',
    );
  });
});
