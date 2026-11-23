import crypto from 'node:crypto';
import type { ProgressFn } from '../types';

/**
 * Login interactivo con el mismo flujo SSO que usa la app móvil oficial de Moodle:
 *
 *   1. Abrimos un navegador VISIBLE (tu Edge/Chrome instalado) en admin/tool/mobile/launch.php.
 *   2. Moodle te redirige a su login (Office 365, MFA...). Lo haces TÚ; StudyVault nunca ve la contraseña.
 *   3. Tras el login, Moodle responde con moodlemobile://token=<base64>. Interceptamos esa respuesta,
 *      verificamos su firma (md5(wwwroot + passport)) y extraemos el token de la API.
 *   4. Cerramos el navegador. El contexto es efímero: no se guardan cookies en disco.
 */
export async function obtainTokenInteractive(opts: {
  baseUrl: string;
  channel: 'msedge' | 'chrome' | 'chromium';
  onProgress?: ProgressFn;
  timeoutMs?: number;
}): Promise<{ token: string; privateToken: string | null }> {
  const { chromium } = await import('playwright-core');
  const log = opts.onProgress ?? (() => {});
  const passport = String(Math.floor(Math.random() * 1e12));
  const launchUrl = `${opts.baseUrl}/admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=${passport}&urlscheme=moodlemobile`;

  log('Abriendo navegador para el inicio de sesión en Moodle…');
  const browser = await chromium.launch({
    channel: opts.channel === 'chromium' ? undefined : opts.channel,
    headless: false,
    args: ['--no-first-run', '--no-default-browser-check'],
  });

  try {
    const context = await browser.newContext({ viewport: null, locale: 'es-ES' });
    const page = await context.newPage();

    const result = new Promise<{ token: string; privateToken: string | null }>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Tiempo de espera agotado para el inicio de sesión')),
        opts.timeoutMs ?? 10 * 60_000,
      );
      browser.on('disconnected', () =>
        reject(new Error('Se cerró el navegador antes de completar el inicio de sesión')),
      );

      void context.route(/\/admin\/tool\/mobile\/launch\.php/, async (route) => {
        try {
          const response = await route.fetch({ maxRedirects: 0 });
          const location = response.headers()['location'] ?? '';
          let scheme = location.startsWith('moodlemobile://') ? location : null;
          if (!scheme && response.status() === 200) {
            const body = await response.text();
            scheme = body.match(/moodlemobile:\/\/token=[A-Za-z0-9+/=]+/)?.[0] ?? null;
          }
          if (!scheme) return route.fulfill({ response });

          const parsed = parseLaunchToken(scheme, opts.baseUrl, passport);
          clearTimeout(timer);
          await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: SUCCESS_PAGE });
          resolve(parsed);
        } catch (err) {
          clearTimeout(timer);
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    });

    // Tras el login con Office 365, Moodle a veces aterriza en el panel en vez de volver a launch.php.
    // Si detectamos que ya estás dentro del campus, repetimos launch.php (ya con sesión) para obtener el token.
    // Ojo: sin sesión, algunos campus mandan a la portada "/", así que solo cuenta como "dentro" si la página no es
    // de usuario anónimo (Moodle marca <body class="notloggedin">).
    let relaunches = 0;
    page.on('load', async () => {
      const url = new URL(page.url());
      log(`Página: ${url.host}${url.pathname}`);
      if (url.origin !== new URL(opts.baseUrl).origin || /\/login\/|\/auth\/|launch\.php/.test(url.pathname))
        return;
      const loggedIn = await page
        .locator('body.notloggedin')
        .count()
        .then((n) => n === 0)
        .catch(() => false);
      if (loggedIn && relaunches < 3) {
        relaunches++;
        log('Sesión detectada en el campus: solicitando acceso de solo lectura para StudyVault…');
        void page.goto(launchUrl).catch(() => {});
      }
    });

    await page.goto(launchUrl);
    log('Esperando a que completes el inicio de sesión en la ventana del navegador…');
    const token = await result;
    log('Sesión verificada. Cerrando navegador.');
    await page.waitForTimeout(1500);
    return token;
  } finally {
    await browser.close().catch(() => {});
  }
}

export function parseLaunchToken(
  schemeUrl: string,
  baseUrl: string,
  passport: string,
): { token: string; privateToken: string | null } {
  const b64 = schemeUrl.replace(/^moodlemobile:\/\/token=/, '');
  const [signature, token, privateToken] = Buffer.from(b64, 'base64').toString('utf8').split(':::');
  if (!signature || !token) throw new Error('Respuesta de Moodle con formato inesperado');
  const candidates = [baseUrl, baseUrl.replace(/^https:/, 'http:')].map((w) =>
    crypto
      .createHash('md5')
      .update(w + passport)
      .digest('hex'),
  );
  if (!candidates.includes(signature))
    throw new Error('Firma del token no válida: se descarta por seguridad');
  return { token, privateToken: privateToken ?? null };
}

const SUCCESS_PAGE = `<!doctype html><meta charset="utf-8"><title>StudyVault</title>
<body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#0b0d12;color:#e7e9ee">
<div style="text-align:center"><div style="font-size:48px">✓</div><h1 style="font-weight:600">Conectado a StudyVault</h1>
<p style="opacity:.7">Puedes cerrar esta ventana. Acceso de solo lectura.</p></div></body>`;
