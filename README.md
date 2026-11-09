# LinkedIn Real Bold

A lightweight browser extension that adds a floating **B** button next to selected text in LinkedIn's editor. It toggles real rich-text formatting in the composer instead of replacing letters with Unicode lookalikes, so Polish diacritics and other international characters stay intact.

The extension changes the editable content in your browser. Whether formatting survives publishing, reopening a draft, or viewing a post depends on LinkedIn; the extension does not control LinkedIn's storage or rendering.

## Features

- Toggle bold on selected text with a single button.
- Keep the original characters, including `ąćęłńóśźż`, other scripts, and emoji.
- Display a compact toolbar above the selection, or below it when space is limited.
- Keep the toolbar interactive over a modal backdrop using the browser's top layer.
- Preserve the selection while clicking the button and reuse the toolbar when the composer reopens.
- Use the same styling and editing behavior in separate Chrome and Firefox packages.
- Run without dependencies, a build step, telemetry, or external scripts.

## Screenshots

![LinkedIn Real Bold in action](assets/screenshot.png.png)

## Supported Browsers

| Browser | Directory | Verification |
| --- | --- | --- |
| Google Chrome | `chrome-linkedin-real-bold` | Original version tested on LinkedIn by the project owner; translated version tested automatically on a local fixture in Chrome 157.0.8103.38. |
| Mozilla Firefox desktop | `firefox-linkedin-real-bold` | Manifest V3, minimum version 140; tested automatically on a local fixture in Firefox 159.0.1. Live LinkedIn testing is still required. |
| Brave | `chrome-linkedin-real-bold` | Expected to work as a Chromium extension; not tested in Brave. |

Use a current desktop browser. Older browsers without the Popover API may fall back to ordinary positioning, which does not guarantee the same modal layering behavior. Mobile browsers are outside the tested scope.

## Installation

Download or clone this repository and keep the extension directories on disk. Load the directory for your browser, rather than the repository root. There is no browser toolbar popup; the **B** button appears inside the page when you select editable text.

### Google Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the `chrome-linkedin-real-bold` directory.
5. Open or reload LinkedIn. If you restrict the extension's site access, allow it on LinkedIn.

After changing extension files, click **Reload** on its extension card and reload the LinkedIn tab.

### Mozilla Firefox

1. Open `about:debugging`.
2. Select **This Firefox**.
3. Click **Load Temporary Add-on…**.
4. Select `firefox-linkedin-real-bold/manifest.json`.
5. Open or reload LinkedIn. Allow access to LinkedIn if Firefox requests it.

**Temporary add-ons are removed when Firefox restarts.** Repeat these steps for each development session. While Firefox remains open, use **Reload** on the add-on card after editing files, then reload the LinkedIn tab. See Mozilla's [temporary installation instructions](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/).

Permanent installation in standard release Firefox requires an add-on **signed by Mozilla**. This applies to both public AMO listings and self-distributed packages. This repository does not include a signed `.xpi`; see Mozilla's [signing and distribution overview](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/).

### Brave

Open `brave://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `chrome-linkedin-real-bold`. Reload LinkedIn. This installation path is intended for Chromium extensions; Brave-specific behavior has not been tested.

## How to Use

1. Open LinkedIn's post composer.
2. Enter text, for example: `Zażółć gęślą jaźń — Łódź`.
3. Select a non-empty portion of the editable text.
4. Click the floating **B** button to toggle bold. The composer should remain open and the original characters should remain unchanged.
5. Select formatted text again and click **B** to remove bold. A blue button background indicates that the current selection reports bold formatting.

The toolbar hides when the selection becomes empty or leaves a supported editable field. If formatting is rejected, it displays a short English message. Inspect the result in the composer; independently verify any published result before relying on it.

## Project Structure

```text
.
├── chrome-linkedin-real-bold/
│   ├── manifest.json
│   └── content.js
├── firefox-linkedin-real-bold/
│   ├── manifest.json
│   └── content.js
├── tests/
│   └── browser.mjs
└── README.md
```

Each installable extension contains only two files. Its CSS is embedded in `content.js`; `tests/` is development tooling and is not part of either extension.

## How It Works

The manifest injects `content.js` at `document_idle` on `https://www.linkedin.com/*` and `https://linkedin.com/*`. The script listens for selection, pointer, keyboard, focus, scroll, and resize events, coalescing updates with `requestAnimationFrame`.

`editorFromNode()` finds the editable ancestor of each selection endpoint. `getSelectionState()` requires a non-empty selection within one rich-text `contenteditable` and saves a cloned `Range`. Plaintext-only and explicitly non-editable fields are excluded. The detector intentionally accepts any matching editable field on LinkedIn, rather than depending exclusively on a specific post-composer selector.

`mountFor()` attaches one reusable toolbar to the closest composer dialog when present. Its manual popover enters the browser's [top layer](https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/showPopover), and `position()` places it near the selection while considering the viewport and dialog bounds. A Shadow DOM contains its styles. Pointer handlers prevent focus loss and stop bubbling; the click handler restores the saved selection and invokes `document.execCommand('bold')`.

[`execCommand()` is deprecated](https://developer.mozilla.org/en-US/docs/Web/API/Document/execCommand), but remains in use here to preserve the original implementation and native editing history. It runs synchronously from a user click, without nested formatting commands or direct HTML replacement. The script does not rewrite the selected characters.

A per-page initialization guard prevents repeated setup in the same content-script context. The script creates no DOM observers. Selection events discover newly opened editors and reuse the existing toolbar.

### Browser differences

Both packages use Manifest V3 and the same DOM APIs, styling, selectors, and formatting logic. Neither uses `chrome.*` or `browser.*` APIs, so no API wrapper or background worker is necessary. Browser tests confirmed the existing selection and popover approach in both installed engines; no Firefox-specific editing workaround was needed.

The Firefox manifest additionally defines a stable add-on ID, `strict_min_version: "140.0"`, and `data_collection_permissions.required: ["none"]`. These describe the add-on's identity, supported version floor, and lack of data collection under Mozilla's [browser-specific manifest settings](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings). The ID is a development identity, not an AMO listing or a guarantee of signing; keep it stable once registered for distribution. The Firefox script differs only in a browser name in a comment.

## Privacy & Permissions

- The content script runs only on the two HTTPS LinkedIn hosts listed above, in the top-level document. It does not request access to all websites or other LinkedIn subdomains.
- Neither manifest requests additional `permissions`, `host_permissions`, clipboard access, storage access, or background execution. The content-script match patterns still grant page access on LinkedIn; this is necessary to inspect selections and change editable content there.
- The script reads the selection, editable elements, and their geometry, and applies formatting to the current selection. Its fallback editor detector can also operate in other rich-text fields on LinkedIn.
- The extension contains no analytics, telemetry, remote code, network requests, persistent storage, or transmission of selected text. Selection state remains in memory for editing. This describes the extension's code, not LinkedIn's own handling of your posts or the browser's internal services.
- It does not submit posts, request LinkedIn credentials, or access a LinkedIn API.

## Limitations

- LinkedIn can change its DOM, modal behavior, editor framework, or sanitization rules. A browser-native bold operation may be rejected or later removed by LinkedIn.
- Real formatting in the composer does **not** guarantee rich-text formatting in a published post. Live publishing, draft persistence, and downstream rendering have not been verified in this update.
- The detector supports rich-text `contenteditable`, not `<textarea>`, plaintext-only fields, selections spanning different editors, embedded iframe editors, or editors inside page Shadow DOM. Whitespace-only selections do not show the toolbar.
- The code uses the first selected range; disjoint multi-range selection, which Firefox can support, is outside the supported workflow.
- Native undo behavior and generated markup depend on the browser and LinkedIn's editor. Mixed-format selections may not have a single meaningful bold indicator.
- The button may appear below a selection near the top edge. Very small dialogs or unusual transforms may constrain positioning.
- Automated tests use a controlled fixture. Live LinkedIn testing and Brave testing remain necessary. This project is not affiliated with LinkedIn.

## Development

Edit the plain JavaScript and manifests directly; no installation of runtime packages or bundling is required. Keep changes to the tested Chrome implementation small and intentional. The scripts are separate copies so Firefox adjustments can be isolated; carry shared fixes across both files deliberately.

### Automated checks

Node.js 22 or newer is required for the test runner's built-in `WebSocket` and `fetch` support. Run from the repository root:

```sh
node --check chrome-linkedin-real-bold/content.js
node --check firefox-linkedin-real-bold/content.js
node tests/browser.mjs
```

Run one browser with `node tests/browser.mjs chrome` or `node tests/browser.mjs firefox`. Both manifests are checked in either case. By default the runner looks for standard Windows installations. On another system or with a custom installation, set `CHROME_BIN` and/or `FIREFOX_BIN` to the browser executable paths. Chrome must support the DevTools `Extensions.loadUnpacked` command; Firefox must support WebDriver BiDi extension installation. A launch restriction in a sandbox requires permission to run the browser processes.

The dependency-free runner creates isolated temporary profiles and loads the actual extensions. It intercepts page requests and serves a local HTML fixture at a matching LinkedIn URL, so the content scripts run through their manifests without contacting the live LinkedIn page. It sends browser pointer input to the button and checks selection preservation, real bold toggling, international text, modal layering, collapsed selection hiding, partial backward selection, repeated composer replacement, and excluded fields. This exercises the actual content-script isolation boundary, rather than evaluating a copy of the extension in the page's JavaScript world.

The runner terminates the browsers it starts and prints its temporary profile paths. Profiles remain in the system temporary directory for inspection and can be removed after the test browsers have exited. No existing browser profile is used. Structural manifest checks supplement successful browser loading; they are not a substitute for Chrome Web Store or AMO review.

On November 9, 2026, the automated fixture checks passed in Chrome 157.0.8103.38 and Firefox 159.0.1. No pre-existing test suite was present. These results cover the local fixture, not the live LinkedIn editor.

### Manual LinkedIn checklist

Test each browser separately with its corresponding extension directory:

- Open a new post, select part of a sentence, click **B**, and verify that bold changes without closing the composer or moving the page.
- Test `Zażółć gęślą jaźń — Łódź, ĄĘÓŹŻĆŃŚ`, emoji, and another writing system. Confirm that copying the text preserves the original characters.
- Test removing bold, mixed formatting, multiple paragraphs, selection in both directions, and native undo/redo. Check that LinkedIn keeps the change after further typing.
- Confirm that the button stays above the dimmed backdrop, follows a scrolled selection, and fits after resizing the window.
- Collapse the selection, select ordinary page text, close the composer, and reopen it several times. Check for hidden or duplicated buttons and console errors.
- Check keyboard interaction and cancellation of a pointer press, especially if changing focus handlers.
- If publishing or draft persistence matters, verify it separately with content you choose to submit. Do not infer persistence from the composer alone.

When preparing Firefox distribution, package the contents of `firefox-linkedin-real-bold` so `manifest.json` is at the archive root, and follow Mozilla's signing process. Do not include test profiles or development tooling in an extension package.
