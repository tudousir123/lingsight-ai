// Run from the repository root: node docs/evidence/deploy-20261112/verify-browser.mjs
// Uses the preserved account, creates no application objects, and stores no auth state.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const credentials = JSON.parse(execFileSync('python', ['-c', `
import pathlib, ast, json
p = pathlib.Path('/home/x/.config/lingsight/acceptance-login.env')
print(json.dumps({k: ast.literal_eval(v) for k, v in
    (line.split('=', 1) for line in p.read_text().splitlines() if '=' in line)}))
`], { encoding: 'utf8' }));
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => localStorage.setItem('lingsight.onboarding-seen.v1', '1'));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const loginResponse = await page.goto('http://localhost:8000/login');
  await page.getByTestId('email-input').fill(credentials.FIRST_SUPERUSER);
  await page.getByTestId('password-input').fill(credentials.FIRST_SUPERUSER_PASSWORD);
  await page.getByRole('button', { name: 'Log In', exact: true }).click();
  await page.waitForURL(url => url.pathname === '/' || url.pathname === '/onboarding');
  const destination = new URL(page.url()).pathname;
  const routes = [];
  for (const path of ['/', '/inference']) {
    const response = await page.goto(`http://localhost:8000${path}`);
    await page.waitForLoadState('networkidle');
    const rendered = (await page.locator('body').innerText()).length > 100;
    const reload = await page.reload();
    await page.waitForLoadState('networkidle');
    routes.push({ path, http_status: response.status(), browser_path: new URL(page.url()).pathname,
      body_rendered: rendered, reload_status: reload.status() });
  }
  const result = {
    login_page_http_status: loginResponse.status(),
    original_admin_login_destination: destination,
    routes,
    javascript_errors: errors,
    notes: 'Original restored admin used. No account, project, video, publication or task was created. Browser state ephemeral; no screenshot containing personal data saved. Project detail requires a real project; /projects is not an index route.',
  };
  writeFileSync('docs/evidence/deploy-20261112/platform-browser-readiness.json', `${JSON.stringify(result, null, 2)}\n`);
  if (result.login_page_http_status !== 200 || errors.length || routes.some(route =>
    route.http_status !== 200 || route.reload_status !== 200 || !route.body_rendered || route.browser_path !== route.path)) {
    throw new Error('Production browser readiness failed; see sanitized JSON evidence');
  }
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
