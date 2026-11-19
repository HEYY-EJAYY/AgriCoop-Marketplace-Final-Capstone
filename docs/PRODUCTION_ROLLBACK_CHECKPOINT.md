# Production rollback checkpoint

This checkpoint records the currently serving Vercel production deployment before any proposed release. It does not change the deployment, project settings, domain aliases, or production database.

## Preserved production deployment

- Project: `agricoop-marketplace-final-capstone`
- Project ID: `prj_LCxJgY2qeXdRNBgOnTeXvJbgXXDI`
- Repository: `HEYY-EJAYY/AgriCoop-Marketplace-Final-Capstone`
- Production deployment ID: `dpl_3aQhfyBhAtYxc3WUbtyzhjf57Hkp`
- Immutable deployment URL: <https://agricoop-marketplace-final-capstone-ib7g1bqoa-ejay5.vercel.app>
- Current production alias: <https://agricoop-marketplace-final-capstone.vercel.app>
- Source branch: `finish/agricoop-complete`
- Source commit: `47cbe65096c4da5762555b92654ed3983e73dbaf`
- Created: 2026-11-18 07:13:16 UTC (2026-11-18 15:13:16 +08:00)
- Ready: 2026-11-18 07:14:42 UTC (2026-11-18 15:14:42 +08:00)
- Verified status: `READY`; deployment details show the production target and the production alias. The deployment is still available and is identified by Vercel as a rollback candidate.

## Rollback procedure

Do not delete the preserved deployment. If a later production release needs to be reverted:

1. In Vercel, open the `agricoop-marketplace-final-capstone` project under the owning team and open **Deployments**.
2. Locate deployment `dpl_3aQhfyBhAtYxc3WUbtyzhjf57Hkp` and verify its immutable URL and `READY` status.
3. Use the deployment action to roll back/promote that deployment to Production and confirm the production alias is assigned to it.
4. Verify the deployment page lists `agricoop-marketplace-final-capstone.vercel.app` on the preserved deployment, then load the public URL and check the affected public routes.

The equivalent Vercel CLI rollback command is:

```powershell
vercel rollback dpl_3aQhfyBhAtYxc3WUbtyzhjf57Hkp
vercel rollback status
```

Vercel documents that rollback to an older deployment is plan-dependent; on Hobby, only the immediately previous production deployment can be selected. If the CLI refuses this target, use the Vercel dashboard to promote the preserved deployment if the project plan permits it. The deployment's immutable URL is:

```text
https://agricoop-marketplace-final-capstone-ib7g1bqoa-ejay5.vercel.app
```

Vercel CLI references:

- <https://vercel.com/docs/cli/rollback>
- <https://vercel.com/docs/deployments/rollback-production-deployment>

Rolling back application code does not reverse database changes. No production database changes or migrations are included in this checkpoint or the proposed release work.
