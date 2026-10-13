# Inno Setup migration checkpoint

Saved on 2026-10-14 before replacing the IExpress installer with Inno Setup. This is a work-in-progress backup, not a release or full acceptance.

Includes the product home/login changes, branding assets, configurable client gateway, installer diagnostics, uninstall implementation and tests. Recent icon integration and compatibility fixes still need combined installer validation. Previous acceptance found incomplete cleanup for hexadecimal user IDs and older packages without uninstall scripts; recheck both against this snapshot. Do not assume earlier test results cover later edits.

This snapshot received diff whitespace checks and PowerShell/JavaScript syntax checks. Build outputs, private environment files and credentials are excluded. config/client.env contains only the public gateway URL.

Continue Inno Setup migration from this branch; preserve user projects, custom gateway settings, private Node isolation, update/rollback and explicit data-removal confirmation. Do not publish until integrated tests pass.
