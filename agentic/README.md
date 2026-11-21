# Aurora Dental Studio, agentified

A static clinic page with an assistant built into it, following the
[Worldwide Agentic Web MVP profile](https://github.com/cognizant-ai-labs/agentic-web/blob/main/docs/worldwide_agentic_web_mvp_spec.md)
(profile 0.3, November 2026). The page has services, a real diary, availability search,
a booking form, booking lookup and cancellation, and a page of policies.

The assistant runs in the visitor's browser on the visitor's own model key. It reads the
page's real data through site actions and calls the same booking functions as the page's
forms, so the two can never disagree. The agent network is published as open JSON, so
another agent site can run it without this site's tools.

This is the competition entry for the Open Agentic Web Challenge, built from the
production workflow in the parent [Frontdesk](../README.md) repository: same clinic, same
services, same cancellation rule.

## Try it

Live: https://frontdesk-agentic.vercel.app/

Locally, from this folder:

```shell
node tools/agentify/scripts/serve_site.mjs . --port 8090
```

Open http://127.0.0.1:8090/. Use a local server rather than opening `index.html` from
disk: browsers do not run JavaScript modules from `file://` pages.

1. Check availability, then select a free time. The booking form fills in and takes a
   name and phone number. Press **Book appointment** to get a code.
2. Under **My booking**, enter that code and name, then cancel and see the fee.
   To try it without booking, use `FD-4K2Q` and `Nadia Farouk`.
3. In **Ask Aurora Dental Studio**, open **⚙ AI model settings**, paste your own
   [Otari](https://otari.ai) key and select **Save and start**. The default router is
   `https://api.otari.ai/api/v1` with `alibaba/qwen3.8-flash`; the panel also fills in
   other providers' URLs and models. Then ask one of the sample queries below.

The assistant sends your messages, and the page data it reads, to the provider you choose.
Afterwards, select **Delete setup** and close the tab: the tab keeps using the key until it
is closed. On `localhost` the runtime also keeps saved keys in a cookie for that host, so
use a key with a low spending limit.

## Sample queries

- What does a teeth cleaning cost, and how long does it take?
- What times are free for a consultation tomorrow?
- Book a teeth cleaning for me: Ana Silva, +971 50 123 4567, at any free time tomorrow.
- Cancel booking FD-7X1M under Omar Haddad and tell me the fee.
- Fill in the booking form for a whitening on Saturday afternoon, and I will add my details.
- Can I pay online or claim this on my insurance?

The last one is there to show the assistant declining: this page takes no payment and
handles no insurance.

## The network

One front agent, `frontdesk_assistant`, with six site actions:

| Action | Effect | Wraps |
| --- | --- | --- |
| `get_clinic_state` | read | clinic facts, services, policies, today's clinic date, 14 bookable days, the form draft |
| `check_availability` | read | `App.page.checkAvailability()` |
| `fill_booking_form` | write | `App.page.fillBookingForm()` |
| `book_appointment` | irreversible | `App.page.bookAppointment()`, behind the page's confirmation dialog |
| `look_up_booking` | read | `App.page.lookUpBooking()` |
| `cancel_appointment` | irreversible | `App.page.cancelAppointment()`, with the fee the visitor saw |

Network URL: `https://frontdesk-agentic.vercel.app/frontdesk_clinic`. Other agent sites
that call it run the network in their visitor's browser on their key; they get no
`website_*` tools, because this site's bridge shares none, so their assistant answers from
the network's instructions and points the visitor to this page. The manifest, network and
discovery files are served with `Access-Control-Allow-Origin: *`.

Facts come only from tool results: prices, hours and policies live in
`js/clinic-core.js` and reach the model through `website_get_clinic_state`, never through
the instructions.

## Files

| Path | What it is |
| --- | --- |
| `index.html`, `styles.css`, `app.js` | the page; `app.js` owns the page object and one store |
| `js/clinic-core.js` | the clinic's data and booking rules, with no DOM |
| `site-actions.js` | the six actions the agents may call |
| `site.js` | boots the runtime, and the two confirmation dialogs |
| `frontdesk_clinic.hocon` | source of truth for the network |
| `frontdesk_clinic.network.json` | built from the HOCON; do not edit by hand |
| `agent-manifest.json`, `links.json`, `agent-mcp.json`, `.well-known/` | public bundle and discovery files |
| `bridge/` | the action bridge other agent sites load; written by the build |
| `runtime/` | the reference browser runtime, copied unchanged |
| `tests/` | Node tests using the real runtime and a scripted model |
| `tools/agentify/` | the agentify scripts and templates used to build the network (Apache-2.0, from `cognizant-ai-labs/agentic-web`) |
| `vercel.json` | CORS on the public files, and the CSP on `runtime/sandbox-worker.js` |

## Build and check

```shell
npm run build   # HOCON -> frontdesk_clinic.network.json, discovery files and bridge
npm run check   # validates the network, manifest and actions
npm test        # 10 Node tests: network, actions, dialog, booking and cancellation
```

## Limits

- Static hosting, with the profile's patched reference runtime. Bookings live in page
  memory: reloading the page restores the seeded diary.
- `write` actions run without a confirmation dialog (the profile asks for one); here the
  only write is filling the form, and it changes nothing outside the page.
- Every agent sees every `website_*` tool.
- Other agent sites get no site tools, as the bridge shares no actions. Live availability
  and bookings stay on this page.
- The network file, instructions included, is public.
- Nothing is sent to a clinic. The WhatsApp front desk this is modelled on is in the
  parent repository.
