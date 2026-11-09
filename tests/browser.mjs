// Dependency-free integration checks. Uses temporary profiles and a mocked page;
// no LinkedIn account, live page, or post submission is involved.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, mkdtemp, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import { once } from 'node:events';

const root = fileURLToPath(new URL('../', import.meta.url));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const fixture = `<!doctype html><html lang="en"><meta charset="utf-8">
<title>Local composer fixture</title><style>
body { margin:0; font:18px Arial; height:1800px; }
dialog, [role=dialog] { position:fixed; inset:100px auto auto 100px;
  margin:0; width:600px; height:400px; padding:24px; background:white;
  border:1px solid #888; box-sizing:border-box; }
dialog::backdrop { background:rgb(0 0 0 / 70%); }
[contenteditable] { margin-top:90px; min-height:120px; border:1px solid #aaa; }
</style><body><p id="outside">Non-editable text</p></body></html>`;

class Protocol {
  constructor(socket) {
    this.socket = socket;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      const entry = this.pending.get(message.id);
      if (entry) {
        clearTimeout(entry.timer);
        this.pending.delete(message.id);
        if (message.error) entry.reject(new Error(JSON.stringify(message)));
        else entry.resolve(message.result);
      } else this.handlers.get(message.method)?.(message.params);
    });
  }
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once:true });
      socket.addEventListener('error', reject, { once:true });
    });
    return new Protocol(socket);
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out: ${method}`));
      }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  close() {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error('Test connection closed'));
    }
    this.pending.clear();
    this.socket.close();
  }
}

for (const kind of ['chrome', 'firefox']) {
  const folder = join(root, `${kind}-linkedin-real-bold`);
  const manifest = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8'));
  new Script(await readFile(join(folder, 'content.js'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.content_scripts.length, 1);
  assert.deepEqual(manifest.content_scripts[0], {
    matches: ['https://www.linkedin.com/*', 'https://linkedin.com/*'],
    js: ['content.js'], run_at: 'document_idle'
  });
  for (const key of ['permissions', 'host_permissions', 'optional_permissions',
    'optional_host_permissions', 'background', 'web_accessible_resources']) {
    assert.equal(manifest[key], undefined, `Unexpected capability: ${key}`);
  }
  if (kind === 'firefox') {
    assert.equal(manifest.browser_specific_settings.gecko.strict_min_version, '140.0');
    assert.deepEqual(manifest.browser_specific_settings.gecko.data_collection_permissions,
      { required: ['none'] });
  }
  console.log(`PASS ${kind}: manifest structure, scope, permissions, JavaScript syntax`);
}

async function startBrowser(kind) {
  const executable = process.env[kind === 'chrome' ? 'CHROME_BIN' : 'FIREFOX_BIN'] ||
    (kind === 'chrome' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' :
      'C:/Program Files/Mozilla Firefox/firefox.exe');
  await access(executable);
  const profile = await mkdtemp(join(tmpdir(), `linkedin-bold-${kind}-`));
  if (kind === 'firefox') await writeFile(join(profile, 'user.js'),
    'user_pref("browser.shell.checkDefaultBrowser", false);\n' +
    'user_pref("browser.startup.homepage_override.mstone", "ignore");\n');
  const args = kind === 'chrome' ? ['--headless=new', `--user-data-dir=${profile}`,
    '--remote-debugging-port=0', '--enable-unsafe-extension-debugging',
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking', 'about:blank'] :
    ['--headless', '--no-remote', '--profile', profile, '--remote-debugging-port', '0', 'about:blank'];
  const child = spawn(executable, args, { windowsHide:true, stdio:['ignore', 'ignore', 'pipe'] });
  let output = '';
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Browser startup timed out: ${output}`)), 20000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.stderr.on('data', data => {
      output += data.toString();
      const match = output.match(/(?:DevTools|WebDriver BiDi) listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  }).catch(error => { child.kill(); throw error; });
  return { child, endpoint, profile };
}

async function run(kind) {
  const { child, endpoint, profile } = await startBrowser(kind);
  const connections = [];
  let control;
  try {
    control = await Protocol.connect(endpoint + (kind === 'firefox' ? '/session' : ''));
    connections.push(control);
    let page, context, version;
    const folder = resolve(root, `${kind}-linkedin-real-bold`);
    if (kind === 'firefox') {
      const session = await control.send('session.new', { capabilities:{} });
      version = session.capabilities.browserVersion;
      const installed = await control.send('webExtension.install', {
        extensionData: { type:'path', path:folder }
      });
      assert.equal(installed.extension, 'linkedin-real-bold@extensions.local');
      context = (await control.send('browsingContext.getTree')).contexts[0].context;
      await control.send('session.subscribe', { events:['network.beforeRequestSent', 'log.entryAdded'] });
      control.handlers.set('log.entryAdded', entry => {
        if (entry.level === 'error' || entry.level === 'warn') console.error('Firefox:', entry.text);
      });
      control.handlers.set('network.beforeRequestSent', params => {
        if (params.isBlocked) control.send('network.provideResponse', {
          request:params.request.request, statusCode:200,
          headers:[{ name:'Content-Type', value:{ type:'string', value:'text/html; charset=utf-8' } }],
          body:{ type:'string', value:fixture }
        }).catch(error => console.error(error));
      });
      await control.send('network.addIntercept', { phases:['beforeRequestSent'] });
      await control.send('browsingContext.navigate', {
        context, url:'https://www.linkedin.com/extension-local-fixture', wait:'complete'
      });
    } else {
      version = (await control.send('Browser.getVersion')).product;
      const installed = await control.send('Extensions.loadUnpacked', { path:folder });
      assert.ok(installed.id);
      const base = endpoint.replace(/^ws:/, 'http:').split('/devtools/')[0];
      const targets = await (await fetch(`${base}/json/list`)).json();
      page = await Protocol.connect(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
      connections.push(page);
      page.handlers.set('Fetch.requestPaused', params => {
        page.send('Fetch.fulfillRequest', { requestId:params.requestId, responseCode:200,
          responseHeaders:[{ name:'Content-Type', value:'text/html; charset=utf-8' }],
          body:Buffer.from(fixture).toString('base64') }).catch(error => console.error(error));
      });
      await page.send('Fetch.enable', { patterns:[{ urlPattern:'*' }] });
      await page.send('Page.navigate', { url:'https://www.linkedin.com/extension-local-fixture' });
    }
    const evaluate = async expression => {
      if (kind === 'firefox') {
        const result = await control.send('script.evaluate', {
          expression:`(async () => JSON.stringify(await (${expression})))()`,
          target:{ context }, awaitPromise:true
        });
        if (result.type === 'exception') throw new Error(result.exceptionDetails.text);
        return JSON.parse(result.result.value ?? 'null');
      }
      const result = await page.send('Runtime.evaluate', {
        expression:`(async () => (${expression}))()`, awaitPromise:true, returnByValue:true
      });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const waitFor = async (expression, label) => {
      for (let i = 0; i < 80; i++) {
        if (await evaluate(expression)) return;
        await pause(50);
      }
      throw new Error(`Timed out: ${label}; ${JSON.stringify(await evaluate(`({
        url:location.href, text:getSelection()?.toString(),
        host:document.querySelector('#linkedin-real-bold-v03')?.outerHTML,
        body:document.body.innerHTML
      })`))}`);
    };
    await waitFor('document.title === "Local composer fixture"', 'fixture navigation');
    // Setup and assertions run in the page. The installed extension runs in its
    // own content-script world and receives actual browser pointer input.
    await evaluate(`(() => {
      window.sample = 'Zażółć gęślą jaźń — Łódź, ĄĘÓŹŻĆŃŚ € 中文 😀';
      window.makeDialog = (native = true) => {
        const modal = document.createElement(native ? 'dialog' : 'div');
        modal.id = 'composer';
        if (!native) modal.setAttribute('role', 'dialog');
        const editor = document.createElement('div');
        editor.id = 'editor'; editor.contentEditable = 'true';
        editor.textContent = sample; modal.append(editor); document.body.append(modal);
        if (native) modal.showModal();
      };
      window.selectText = (start = 0, end = sample.length, reverse = false) => {
        const editor = document.querySelector('#editor'); editor.focus();
        const range = document.createRange(); range.selectNodeContents(editor);
        const selection = getSelection(); selection.removeAllRanges();
        if (start !== 0 || end !== sample.length) {
          range.setStart(editor.firstChild, start); range.setEnd(editor.firstChild, end);
        }
        selection.addRange(range);
        if (reverse) selection.setBaseAndExtent(range.endContainer, range.endOffset,
          range.startContainer, range.startOffset);
      };
      window.toolbar = () => document.querySelector('#linkedin-real-bold-v03');
      window.visible = () => Boolean(toolbar()?.matches(':popover-open'));
      makeDialog(); selectText(); return true;
    })()`);
    // document_idle can run after navigation completes. Retry selection until
    // the installed content script has attached its event handlers.
    await waitFor('(visible() || (selectText(), false))', 'automatic content-script injection and toolbar display');
    console.log(`PASS ${kind} ${version}: real extension installation and automatic injection on intercepted fixture`);
    const clickBold = async () => {
      const { x, y } = await evaluate(`(() => {
        const host = toolbar(); const button = host.shadowRoot.querySelector('button');
        const box = button.getBoundingClientRect();
        return { x:Math.round(box.x + box.width / 2), y:Math.round(box.y + box.height / 2) };
      })()`);
      if (kind === 'firefox') await control.send('input.performActions', { context,
        actions:[{ type:'pointer', id:'mouse', parameters:{ pointerType:'mouse' },
          actions:[{ type:'pointerMove', x, y, origin:'viewport' },
            { type:'pointerDown', button:0 }, { type:'pointerUp', button:0 }] }] });
      else {
        await page.send('Input.dispatchMouseEvent', { type:'mouseMoved', x, y });
        await page.send('Input.dispatchMouseEvent', { type:'mousePressed', x, y, button:'left', clickCount:1 });
        await page.send('Input.dispatchMouseEvent', { type:'mouseReleased', x, y, button:'left', clickCount:1 });
      }
      await pause(100);
    };
    const check = async (expression, label) => {
      assert.equal(await evaluate(expression), true, `${kind}: ${label}`);
      console.log(`PASS ${kind}: ${label}`);
    };
    await check(`(() => {
      const host = toolbar(), box = host.getBoundingClientRect();
      const selectionBox = getSelection().getRangeAt(0).getClientRects()[0];
      return host.parentElement === document.querySelector('#composer') &&
        document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === host &&
        box.bottom < selectionBox.top && host.shadowRoot.querySelector('button').textContent === 'B';
    })()`, 'button above selection, hit-testable over native modal backdrop');
    await clickBold();
    await check(`document.querySelector('#composer').open &&
      document.querySelector('#editor').textContent === sample &&
      getSelection().toString() === sample && document.queryCommandState('bold') &&
      Number(getComputedStyle(document.querySelector('#editor').firstElementChild).fontWeight) >= 600`,
      'trusted click applies real bold, preserves selection and international characters, keeps modal open');
    await evaluate('(selectText(), true)');
    await waitFor('visible()', 'toolbar after bold');
    await check(`toolbar().shadowRoot.querySelector('button').getAttribute('aria-pressed') === 'true'`, 'bold state indication');
    await clickBold();
    await check(`!document.queryCommandState('bold') && document.querySelector('#editor').textContent === sample`, 'second click removes bold');
    await evaluate('(getSelection().collapseToEnd(), true)');
    await waitFor('!visible()', 'hide collapsed selection');
    console.log(`PASS ${kind}: hides after selection collapse`);
    await evaluate('(selectText(0, 6, true), true)');
    await waitFor('visible()', 'reverse selection');
    await clickBold();
    await check(`getSelection().toString() === sample.slice(0, 6) &&
      document.queryCommandState('bold') && document.querySelector('#editor').textContent === sample`, 'partial backward selection');
    await evaluate(`(() => {
      document.querySelector('#composer').close(); document.querySelector('#composer').remove();
      getSelection().removeAllRanges(); return true;
    })()`);
    await pause(100);
    await check('!visible()', 'toolbar hidden after composer removal');
    for (let i = 0; i < 3; i++) {
      await evaluate(`(makeDialog(${i !== 1}), selectText(), true)`);
      await waitFor('visible()', 'toolbar after reopen');
      await check(`document.querySelectorAll('#linkedin-real-bold-v03').length === 1 &&
        toolbar().parentElement === document.querySelector('#composer')`, `reopen ${i + 1}: one toolbar in current dialog`);
      await clickBold();
      await check(`document.queryCommandState('bold') && document.querySelector('#editor').textContent === sample`, `reopen ${i + 1}: one formatting action per click`);
      await evaluate(`(document.querySelector('#composer').remove(), getSelection().removeAllRanges(), true)`);
      await pause(100);
    }
    await evaluate(`(() => {
      makeDialog(); const editor = document.querySelector('#editor');
      editor.replaceChildren();
      for (const text of [sample, 'Second paragraph: café, Ελληνικά']) {
        const paragraph = document.createElement('p'); paragraph.textContent = text; editor.append(paragraph);
      }
      window.paragraphText = editor.textContent; selectText(); return true;
    })()`);
    await waitFor('visible()', 'multiple paragraphs');
    await clickBold();
    await check(`document.querySelector('#editor').textContent === paragraphText &&
      Array.from(document.querySelectorAll('#editor p')).every(paragraph =>
        Number(getComputedStyle(paragraph.firstElementChild || paragraph).fontWeight) >= 600)`,
      'real bold across paragraphs and multiple text nodes');
    await evaluate(`(document.querySelector('#composer').remove(), getSelection().removeAllRanges(), true)`);
    await evaluate(`(makeDialog(), document.querySelector('#editor').contentEditable = 'plaintext-only', selectText(), true)`);
    await pause(100);
    await check('!visible()', 'ignores plaintext-only editor');
    await evaluate(`(document.querySelector('#editor').contentEditable = 'false', selectText(), true)`);
    await pause(100);
    await check('!visible()', 'ignores non-editable selection');
    console.log(`PASS ${kind}: browser suite complete (temporary profile: ${profile})`);
  } finally {
    // Only terminate the browser process launched for this test.
    if (control) {
      const exit = once(child, 'exit');
      control.send(kind === 'firefox' ? 'session.end' : 'Browser.close').catch(() => {});
      await Promise.race([exit, pause(2500)]);
    }
    for (const connection of connections) connection.close();
    if (child.exitCode === null) child.kill();
    child.stderr.destroy();
  }
}

const requested = process.argv[2];
assert.ok(!requested || ['chrome', 'firefox'].includes(requested), 'Use: node tests/browser.mjs [chrome|firefox]');
for (const kind of requested ? [requested] : ['chrome', 'firefox']) await run(kind);
