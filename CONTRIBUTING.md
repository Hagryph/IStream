# Contributing

Contributions are welcome for noncommercial development of IStream.

By submitting a contribution, you certify that you have the right to provide it and agree that it will be licensed under the PolyForm Noncommercial License 1.0.0 together with the rest of IStream. Do not submit third-party code unless its license is documented and compatible with redistribution in this source-available project.

Before submitting a change, run:

```powershell
npm.cmd run licenses:audit
npm.cmd run check:oop
npm.cmd run typecheck
npm.cmd test
```

Do not commit credentials, signing certificates, private keys, generated installers, `dist/`, `out/`, or application user data.
