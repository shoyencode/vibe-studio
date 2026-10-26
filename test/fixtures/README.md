# Reference fixtures

These files are self-contained, test-only reference fixtures, initially extracted with Vibe Studio 0.3.0 (base commit `91e00e7`, on 2026-10-22) and adapted to neutral fixture names. They are covered by the MIT license and original copyright in the repository's `LICENSE`. They are not included in the portable application and require no external checkout.

- `demo/`: the small fictional three-step kit, copied with its APM manifest, skill assets, agent and approval script. It exercises a kit without costs, sources, review or application modules.
- `reference-kit/`: only the step skill files, protocol-2 contract, configuration schema/template and approval script needed by bridge/controller tests. It is not a complete deployable kit. Its instructions use Vibe Studio's current report tool and identifiers.

Approval scripts are kit-owned fixtures, not runtime implementations; the generic application invokes the script declared by the opened project's contract. Do not change fixtures just to make a failing test pass. Update them deliberately with compatible contract examples and rerun the bridge, controller and desktop checks. All checks run against local fixtures.
