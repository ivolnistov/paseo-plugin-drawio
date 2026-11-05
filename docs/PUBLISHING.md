# Publication preparation

This repository is prepared for Git-based distribution. It is not yet listed in the Paseo registry. The GitHub repository is currently private. No npm publication is required for this route; `private: true` in `package.json` deliberately prevents accidental npm publication.

## Release checks

- Run the typecheck and tests with a compatible Node version.
- Check `npm pack --dry-run --ignore-scripts` includes the runtime entries, imported modules, bundled viewer and shape index, licenses, shrinkwrap, overview, examples and both manifest media files.
- Confirm screenshots show the current interface with sample data and no private details.
- Before changing visibility, obtain the owner's decision on historical author email addresses and worker hostname metadata, the six checkpoint branches, and internal planning/acceptance reports. All become public with the repository. Removing a current file does not erase its history. Keep the repository private until that decision; do not rewrite history without authorization.
- Install the selected Git revision on an isolated test daemon and exercise the file panel, inline rendering and agent tools.
- Review the runtime routing-library download against the registry's explicit-confirmation requirement. The current implementation discloses the download but does not present its own confirmation prompt. Documentation alone does not resolve this question.
- Resolve or document the availability of corresponding source for the optional ELK bundle. See `NOTICE.md`; the bundle is downloaded rather than shipped in this repository.
- Obtain owner approval of the final repository text, public visibility change and submission text before publishing them.

`npm-shrinkwrap.json` is the committed dependency lock for this repository; `npm ci` consumes it. There is no separate `package-lock.json`.

The screenshots and metadata are release materials, not a statement that registry review has completed. Preserve any remaining validation gaps in the release record.

## GitHub destination

Repository: <https://github.com/ivolnistov/paseo-plugin-drawio>

Proposed repository description:

> View draw.io diagrams in Paseo file tabs and agent replies, and give agents the official draw.io tools

The public registry accepts public GitHub sources. Make this repository public only after the owner approves that change and the publication checks above have been addressed. Push the approved revision before submission. Registry reviewers pin the exact reviewed commit.

## Registry submission draft

Destination: <https://github.com/getpaseo/plugins/issues/new?template=submit-plugin.yml>

Title: `draw.io`

Use the submission form so the issue receives the required `submission` label. It has only Source and Categories fields; [SUBMISSION.md](SUBMISSION.md) contains those values. Source defaults to `main`; supply the final commit URL instead if a specific release should be reviewed. The manifest declares both screenshot paths, so the reviewer can resolve them from the selected revision. No additional comment is proposed.

After submission, record the issue and generated review PR. Git updates require a new submission or an explicit revision request; they do not automatically follow `main`.

## References

- [Paseo publishing guide](https://paseo.sh/docs/plugins/publishing)
- [Registry review policy](https://github.com/getpaseo/plugins/blob/main/REVIEW.md)
- [Submission form](https://github.com/getpaseo/plugins/issues/new?template=submit-plugin.yml)

Requirements checked on 2026-11-05. Registry review is separate from local tests and installation checks.
