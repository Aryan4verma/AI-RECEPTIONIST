# Third-party notices

The root [MIT LICENSE](LICENSE) covers the original Cleardesk code and documentation, not the third-party material below. Preserve applicable notices when redistributing. This inventory does not promise clearance of every trademark, publicity or other third-party right.

## Bundled fonts — SIL Open Font License 1.1

| Files in `frontend/public/fonts/` | Embedded copyright / version | License and source |
| --- | --- | --- |
| `inter-roman.woff2` | Copyright 2016 The Inter Project Authors; Inter 4.001, git-66647c0bb | [OFL-Inter.txt](frontend/public/fonts/OFL-Inter.txt) · [Inter](https://github.com/rsms/inter) |
| `fraunces-roman.woff2`, `fraunces-italic.woff2` | Copyright 2020 The Fraunces Project Authors; version 1.000, b76b70a41 | [OFL-Fraunces.txt](frontend/public/fonts/OFL-Fraunces.txt) · [Fraunces](https://github.com/undercasetype/Fraunces) |

The included files reproduce the projects' published OFL texts; Fraunces' upstream license file also carries its 2018 project notice. Original binary copyright metadata is preserved. These fonts remain under OFL 1.1, including its redistribution, standalone-sale and reserved-name conditions; they are not relicensed under MIT.

## Bundled photographs — Unsplash License

| File in `frontend/public/images/` | Verified source |
| --- | --- |
| `hero-reception.jpg` | [Unsplash photo-1554118811-1e0d58224f24](https://images.unsplash.com/photo-1554118811-1e0d58224f24) — source traced from Git history and checked against the image pixels |
| `promo-cafe.jpg` | [Unsplash photo-1519710164239-da123dc03ef4](https://images.unsplash.com/photo-1519710164239-da123dc03ef4) — identical downloaded image bytes at the recorded size/quality |
| `admin-hero.jpg` | Same verified image as `promo-cafe.jpg`; replaces the earlier photograph whose source could not be established |

These photographs remain subject to the [Unsplash License](https://unsplash.com/license), including restrictions on selling unmodified images and building a competing image service. Attribution/source links are retained here even where not required. No model/property release, endorsement or trademark permission is asserted. The files are decorative photographs, not Cleardesk customer records or evidence of a business relationship.

The replaced photograph remains in earlier Git history; this change does not rewrite history or establish that earlier image's rights. Resolve that historical provenance before a public history distribution.

## README screenshots

The five GitHub attachment URLs were supplied by the project owner for this README. Screenshots illustrate the application; embedded font/photograph rights remain separate from original interface copyright. Do not treat screenshot inclusion as a license to redistribute all depicted third-party content under MIT.

The repository and attachments currently require authorized GitHub access. Their inclusion does not change repository visibility or grant anonymous access. Review screenshot privacy and attachment permissions again before making a public release.

## Dependencies and model weights

JavaScript and Python dependencies retain their own licenses. The manifests/lockfiles identify installed packages; preserve the packages' license and notice files in any redistributed build or dependency bundle. This notice is not a substitute for those files.

In particular, the frontend build toolchain includes [caniuse-lite](https://github.com/browserslist/caniuse-lite) browser-support data (CC BY 4.0; derived from Can I Use by Alexis Deveria and contributors) and [Lightning CSS](https://github.com/parcel-bundler/lightningcss) (MPL 2.0). These are installed dependencies, not a grant of MIT rights to their data or source. Other lockfile licenses include MIT, Apache 2.0, BSD, ISC and 0BSD.

Ollama and downloaded speech/language models are installed separately. Model weights are not bundled in this repository or covered by its MIT license. Check each runtime/model's upstream license and commercial-use conditions before redistribution or deployment.
