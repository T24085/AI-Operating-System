# Private owner access with Tailscale Serve

The application stays on loopback. Tailscale Serve terminates HTTPS for the tailnet and proxies to the production server.

```powershell
$env:AIOS_HTTPS = "1"
npm run build
npm start
tailscale serve --bg http://127.0.0.1:4317
tailscale serve status
```

Use the HTTPS URL printed by `tailscale serve status`. Keep access limited with the tailnet policy; do not enable Funnel for the owner surface.

To remove the proxy:

```powershell
tailscale serve reset
```

The current CLI syntax is documented at https://tailscale.com/docs/reference/tailscale-cli/serve.

## Public tunnel boundary

The future `nova.casa` tunnel must use an HTTP reverse proxy equivalent to `nova-public-proxy.nginx.conf`. It exposes only the public concierge, static assets, and `/api/public/**`. The tunnel must never point directly at port 4317 without that path boundary.
