# RBR-771 RFQ packet build and verification scripts

Tracked build and verification tooling for the four ISO 27001 certification RFQ
packets in `data/rbr-771-final-packets/`.

Restored under **RBR-780**. RBR-771 closed reporting "all nine acceptance
criteria pass reproducibly (`verify-rbr-771.py`, exit 0)", but none of the three
scripts were ever on disk. That made `verification-output.txt` an unreproducible
transcript and left the two build-time guards RBR-771 added — the 1200-character
cover ceiling and the UTF-8 text layer — guarding nothing.

`data/` is gitignored. These scripts are tracked; the artifacts they read and
write are not. That is deliberate: the packets are machine-local, but the ability
to re-verify them must survive.

## Files

| File | Role |
|---|---|
| `packet_spec.py` | Single source of truth: sender identity, the four CBs, the cover-message template, the guard constants, the leak patterns. Everything else imports from here. |
| `verify-rbr-771.py` | Runs all acceptance criteria against the packets. Exit 0 = clean. |
| `build-cover-messages.py` | Renders the four cover messages. Refuses to write one over the ceiling. |
| `regenerate-all-rfq-pdfs.sh` | Rebuilds the four PDFs and their text layers via pandoc + WeasyPrint. |
| `rfq-pdf-style.css` | PDF stylesheet. Holds the `tr { break-inside: avoid }` rule (AC5). |
| `test-guards.py` | Negative tests: proves each guard actually fails on deliberately bad input. |

## Usage

Run from the Aira workspace root:

```bash
python3 scripts/rbr771/verify-rbr-771.py            # verify everything
python3 scripts/rbr771/verify-rbr-771.py --quiet    # verdict only
python3 scripts/rbr771/verify-rbr-771.py --output data/rbr-771-final-packets/verification-output.txt

python3 scripts/rbr771/build-cover-messages.py --check   # verify, do not write
python3 scripts/rbr771/build-cover-messages.py           # rebuild the covers

./scripts/rbr771/regenerate-all-rfq-pdfs.sh              # staged build + compare
./scripts/rbr771/regenerate-all-rfq-pdfs.sh --in-place   # overwrite the packets

python3 scripts/rbr771/test-guards.py                    # prove the guards fire
```

`RBR771_PACKET_ROOT` overrides the packet directory; `test-guards.py` uses it to
run against throwaway broken copies.

Requires `pandoc`, `weasyprint`, `pdftotext`. On macOS:
`brew install pandoc weasyprint poppler`.

## The guards

These exist because the same class of defect reached "ready to send" three
separate times. Both fail rather than emit a bad artifact.

**1200-character cover ceiling.** Web contact forms cap the message field.
RBR-766 inserted the phone-omission wording and never re-measured, shipping
A-LIGN at 1278 and Schellman at 1328 characters. `build-cover-messages.py` now
declines to write an over-ceiling cover at all, and `verify-rbr-771.py` AC7 fails
on one already on disk. The covers are additionally held to pure ASCII, since the
charset of an arbitrary web form is not ours to assume.

**UTF-8 text layer.** `pdftotext` defaults to Latin-1, turning every em-dash into
byte `0x97` and producing a file that will not decode as UTF-8. RBR-771 noted
this "would have caused a verifier to either crash or silently skip checks on
files it could not read" — so AC0 in the verifier checks decodability first and
reports a mis-encoded file as an explicit FAIL, and the PDF build re-decodes as
strict UTF-8 and deletes any artifact that fails.

## On PDF reproducibility

`regenerate-all-rfq-pdfs.sh` is intentionally **staged by default**. The shipped
PDFs were produced by pandoc + WeasyPrint 68.1 and hand-verified on RBR-398
(comment `33795e0e`). A rebuild on a different pandoc/WeasyPrint version produces
the same *content* with different line wrapping and page counts, so a byte-diff
against the shipped PDFs is not a meaningful signal. The verifier therefore
checks content — contact line, title, phone wording, token-freedom, sanitization,
UTF-8, page-break integrity — not bytes. Do not re-cut the shipped packets
without a reason; use `--in-place` only when the source Markdown actually changed.

The cover messages *are* byte-reproducible: `build-cover-messages.py --check`
confirms all four render byte-identically to what shipped (1142 / 1192 / 1191 /
1193 chars).
