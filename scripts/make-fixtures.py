#!/usr/bin/env python3
"""Writes the test PDFs used by native tests, Maestro flows and benchmarks.

    python3 scripts/make-fixtures.py <output-dir>

No third-party packages: the files are written object by object.
"""

import hashlib
import os
import sys

PAD = bytes.fromhex(
    "28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A"
)


def rc4(key, data):
    s = list(range(256))
    j = 0
    for i in range(256):
        j = (j + s[i] + key[i % len(key)]) % 256
        s[i], s[j] = s[j], s[i]
    out = bytearray()
    i = j = 0
    for byte in data:
        i = (i + 1) % 256
        j = (j + s[i]) % 256
        s[i], s[j] = s[j], s[i]
        out.append(byte ^ s[(s[i] + s[j]) % 256])
    return bytes(out)


class Writer:
    """Collects numbered objects and writes a classic xref table."""

    def __init__(self):
        self.objects = {}
        self.next_id = 1
        self.encrypt = None

    def reserve(self):
        number = self.next_id
        self.next_id += 1
        return number

    def add(self, body, number=None):
        number = number or self.reserve()
        self.objects[number] = body
        return number

    def stream(self, data, extra="", number=None):
        return self.add(("stream", data, extra), number)

    def _crypt(self, number, data):
        if not self.encrypt:
            return data
        key = self.encrypt + number.to_bytes(3, "little") + b"\x00\x00"
        return rc4(hashlib.md5(key).digest()[: min(len(self.encrypt) + 5, 16)], data)

    def _encode_strings(self, number, text):
        """Encrypts every (literal) string in `text`."""
        if not self.encrypt:
            return text.encode("latin-1")
        out = bytearray()
        index = 0
        raw = text.encode("latin-1")
        while index < len(raw):
            if raw[index : index + 1] == b"(":
                depth = 1
                end = index + 1
                value = bytearray()
                while depth:
                    ch = raw[end : end + 1]
                    if ch == b"\\":
                        value += raw[end + 1 : end + 2]
                        end += 2
                        continue
                    if ch == b"(":
                        depth += 1
                    elif ch == b")":
                        depth -= 1
                        if depth == 0:
                            break
                    value += ch
                    end += 1
                out += b"<" + self._crypt(number, bytes(value)).hex().encode() + b">"
                index = end + 1
            else:
                out += raw[index : index + 1]
                index += 1
        return bytes(out)

    def write(self, path, root, info=None, trailer_extra=""):
        out = bytearray(b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")
        offsets = {}
        for number in sorted(self.objects):
            offsets[number] = len(out)
            body = self.objects[number]
            out += f"{number} 0 obj\n".encode()
            if isinstance(body, tuple):
                _, data, extra = body
                payload = data if number == self._encrypt_obj else self._crypt(number, data)
                out += f"<< /Length {len(payload)} {extra} >>\nstream\n".encode()
                out += payload + b"\nendstream"
            elif number == self._encrypt_obj:
                out += body.encode("latin-1")
            else:
                out += self._encode_strings(number, body)
            out += b"\nendobj\n"
        xref = len(out)
        size = max(self.objects) + 1
        out += f"xref\n0 {size}\n0000000000 65535 f \n".encode()
        for number in range(1, size):
            if number in offsets:
                out += f"{offsets[number]:010d} 00000 n \n".encode()
            else:
                out += b"0000000000 65535 f \n"
        trailer = f"/Size {size} /Root {root} 0 R"
        if info:
            trailer += f" /Info {info} 0 R"
        out += f"trailer\n<< {trailer} {trailer_extra} >>\nstartxref\n{xref}\n%%EOF\n".encode()
        with open(path, "wb") as handle:
            handle.write(out)

    _encrypt_obj = -1


def text_page(writer, pages_id, font_id, label, width=612, height=792, extra="", body_lines=()):
    lines = [f"BT /F1 36 Tf 72 {height - 120} Td ({label}) Tj ET"]
    y = height - 200
    for line in body_lines:
        lines.append(f"BT /F1 14 Tf 72 {y} Td ({line}) Tj ET")
        y -= 22
    content = writer.stream("\n".join(lines).encode("latin-1"))
    return writer.add(
        f"<< /Type /Page /Parent {pages_id} 0 R /MediaBox [0 0 {width} {height}] "
        f"/Resources << /Font << /F1 {font_id} 0 R >> >> /Contents {content} 0 R {extra} >>"
    )


def make_pages(path, count, with_extras=True):
    writer = Writer()
    catalog = writer.reserve()
    pages = writer.reserve()
    font = writer.add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    kids = []
    for index in range(count):
        kids.append(writer.reserve())
    for index, number in enumerate(kids):
        extra = ""
        body = [f"The quick brown fox jumps over the lazy dog on page {index + 1}.", "Needle"]
        if with_extras and index == 0 and count > 2:
            link = writer.add(
                f"<< /Type /Annot /Subtype /Link /Rect [72 500 300 530] /Border [0 0 0] "
                f"/Dest [{kids[2]} 0 R /Fit] >>"
            )
            uri = writer.add(
                "<< /Type /Annot /Subtype /Link /Rect [72 450 300 480] /Border [0 0 0] "
                "/A << /S /URI /URI (https://example.com/) >> >>"
            )
            extra = f"/Annots [{link} 0 R {uri} 0 R]"
            body.append("Go to page 3")
        if with_extras and index == 1:
            extra += " /Rotate 90"
        content_lines = [f"BT /F1 36 Tf 72 672 Td (Page {index + 1}) Tj ET"]
        y = 600
        for line in body:
            content_lines.append(f"BT /F1 14 Tf 72 {y} Td ({line}) Tj ET")
            y -= 50 if line == "Needle" else 22
        content = writer.stream("\n".join(content_lines).encode("latin-1"))
        writer.add(
            f"<< /Type /Page /Parent {pages} 0 R /MediaBox [0 0 612 792] "
            f"/Resources << /Font << /F1 {font} 0 R >> >> /Contents {content} 0 R {extra} >>",
            number,
        )
    writer.add(f"<< /Type /Pages /Kids [{' '.join(f'{k} 0 R' for k in kids)}] /Count {count} >>", pages)
    outline_ref = ""
    if with_extras and count > 2:
        outlines = writer.reserve()
        first = writer.reserve()
        second = writer.reserve()
        child = writer.reserve()
        writer.add(f"<< /Type /Outlines /First {first} 0 R /Last {second} 0 R /Count 3 >>", outlines)
        writer.add(f"<< /Title (Introduction) /Parent {outlines} 0 R /Next {second} 0 R /Dest [{kids[0]} 0 R /Fit] >>", first)
        writer.add(
            f"<< /Title (Chapter Two) /Parent {outlines} 0 R /Prev {first} 0 R /First {child} 0 R /Last {child} 0 R "
            f"/Count 1 /Dest [{kids[1]} 0 R /Fit] >>",
            second,
        )
        writer.add(f"<< /Title (Section 2.1) /Parent {second} 0 R /Dest [{kids[2]} 0 R /Fit] >>", child)
        outline_ref = f"/Outlines {outlines} 0 R"
    writer.add(f"<< /Type /Catalog /Pages {pages} 0 R {outline_ref} >>", catalog)
    writer.write(path, catalog)


def make_form(path):
    writer = Writer()
    catalog = writer.reserve()
    pages = writer.reserve()
    page = writer.reserve()
    font = writer.add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    zadb = writer.add("<< /Type /Font /Subtype /Type1 /BaseFont /ZapfDingbats >>")
    on = writer.stream(b"q 0 0 0 rg BT /ZaDb 14 Tf 2 4 Td (4) Tj ET Q", f"/Type /XObject /Subtype /Form /BBox [0 0 20 20] /Resources << /Font << /ZaDb {zadb} 0 R >> >>")
    off = writer.stream(b"", "/Type /XObject /Subtype /Form /BBox [0 0 20 20]")
    name = writer.add(
        f"<< /Type /Annot /Subtype /Widget /FT /Tx /T (name) /V () /Rect [150 650 400 675] "
        f"/F 4 /P {page} 0 R /DA (/Helv 12 Tf 0 g) /MK << /BC [0 0 0] >> >>"
    )
    agree = writer.add(
        f"<< /Type /Annot /Subtype /Widget /FT /Btn /T (agree) /V /Off /AS /Off /Rect [150 600 170 620] "
        f"/F 4 /P {page} 0 R /MK << /BC [0 0 0] /CA (4) >> /AP << /N << /Yes {on} 0 R /Off {off} 0 R >> >> >>"
    )
    color = writer.add(
        f"<< /Type /Annot /Subtype /Widget /FT /Ch /Ff 131072 /T (color) /V (Red) /Opt [(Red) (Green) (Blue)] "
        f"/Rect [150 550 300 575] /F 4 /P {page} 0 R /DA (/Helv 12 Tf 0 g) >>"
    )
    content = writer.stream(
        b"BT /F1 14 Tf 72 655 Td (Name:) Tj ET\nBT /F1 14 Tf 72 605 Td (Agree:) Tj ET\nBT /F1 14 Tf 72 555 Td (Colour:) Tj ET"
    )
    writer.add(
        f"<< /Type /Page /Parent {pages} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 {font} 0 R >> >> "
        f"/Contents {content} 0 R /Annots [{name} 0 R {agree} 0 R {color} 0 R] >>",
        page,
    )
    writer.add(f"<< /Type /Pages /Kids [{page} 0 R] /Count 1 >>", pages)
    helv = writer.add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
    writer.add(
        f"<< /Type /Catalog /Pages {pages} 0 R /AcroForm << /Fields [{name} 0 R {agree} 0 R {color} 0 R] "
        f"/DA (/Helv 12 Tf 0 g) /DR << /Font << /Helv {helv} 0 R /ZaDb {zadb} 0 R >> >> /NeedAppearances true >> >>",
        catalog,
    )
    writer.write(path, catalog)


def make_encrypted(path, user=b"secret", owner=b"owner"):
    """Standard security handler, revision 2 (40-bit RC4)."""
    writer = Writer()
    file_id = hashlib.md5(path.encode()).digest()
    owner_key = hashlib.md5((owner + PAD)[:32]).digest()[:5]
    o_value = rc4(owner_key, (user + PAD)[:32])
    permissions = -4
    key = hashlib.md5((user + PAD)[:32] + o_value + permissions.to_bytes(4, "little", signed=True) + file_id).digest()[:5]
    u_value = rc4(key, PAD)
    catalog = writer.reserve()
    pages = writer.reserve()
    font = writer.add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    kids = [writer.reserve() for _ in range(2)]
    for index, number in enumerate(kids):
        content = writer.stream(f"BT /F1 36 Tf 72 672 Td (Secret page {index + 1}) Tj ET".encode())
        writer.add(
            f"<< /Type /Page /Parent {pages} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 {font} 0 R >> >> "
            f"/Contents {content} 0 R >>",
            number,
        )
    writer.add(f"<< /Type /Pages /Kids [{' '.join(f'{k} 0 R' for k in kids)}] /Count 2 >>", pages)
    writer.add(f"<< /Type /Catalog /Pages {pages} 0 R >>", catalog)
    encrypt = writer.add(
        f"<< /Filter /Standard /V 1 /R 2 /O <{o_value.hex()}> /U <{u_value.hex()}> /P {permissions} >>"
    )
    writer._encrypt_obj = encrypt
    writer.encrypt = key
    writer.write(path, catalog, trailer_extra=f"/Encrypt {encrypt} 0 R /ID [<{file_id.hex()}> <{file_id.hex()}>]")


def main():
    output = sys.argv[1] if len(sys.argv) > 1 else "fixtures"
    os.makedirs(output, exist_ok=True)
    make_pages(os.path.join(output, "sample.pdf"), 5)
    make_form(os.path.join(output, "form.pdf"))
    make_encrypted(os.path.join(output, "encrypted.pdf"))
    for count in (10, 100, 500, 1000):
        make_pages(os.path.join(output, f"pages-{count}.pdf"), count, with_extras=False)
    print(f"wrote fixtures to {output}")


if __name__ == "__main__":
    main()
