# Third-party notices

IStream's PolyForm Noncommercial license applies only to original IStream code and documentation owned by its contributors. It does not replace, narrow, or add restrictions to third-party licenses. Third-party components may grant rights, including commercial-use rights, independently of IStream.

The exact locked npm dependency inventory and declared SPDX expressions are recorded in `docs/legal/dependency-license-report.json`. The build fails when a dependency has a missing or unreviewed license declaration.

## Components shipped with the Windows application

### Electron

Copyright (c) Electron contributors

Copyright (c) 2013-2020 GitHub Inc.

Electron is licensed under the MIT License. The packaged application retains `LICENSE.electron.txt`. Electron also includes Chromium and related components; their complete notices are retained in `LICENSES.chromium.html` beside the installed executable.

### React, React DOM, and Scheduler

Copyright (c) Meta Platforms, Inc. and affiliates.

These packages are licensed under the MIT License:

> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

### Electron MIT terms

Electron's MIT permission and warranty terms are the same text reproduced above. Its own copyright notices are listed in the Electron section and its authoritative license file is included in every packaged build.

## Build-time dependency requiring attribution

`caniuse-lite` by Ben Briggs and the Browserslist contributors is licensed under Creative Commons Attribution 4.0. It is a development-only browser compatibility dataset and is not packaged as an application runtime dependency. Project: https://github.com/browserslist/caniuse-lite — license: https://creativecommons.org/licenses/by/4.0/

## Remaining build and development dependencies

The remaining locked packages declare MIT, ISC, Apache-2.0, BSD-2-Clause, BSD-3-Clause, 0BSD, BlueOak-1.0.0, CC0-1.0, Python-2.0, Unlicense, or WTFPL-compatible terms. They are used to build and test IStream and are not application runtime dependencies unless separately identified above. Their names, exact versions, development/runtime classification, and license expressions are included in the generated dependency report.
