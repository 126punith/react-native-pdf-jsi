// Native tests for PdfiumSession. Built with the NDK and run on a device or
// emulator by scripts/run-native-tests.sh against scripts/make-fixtures.py output.

#include "PdfiumSession.hpp"

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <functional>
#include <string>
#include <sys/stat.h>
#include <vector>

using namespace margelo::nitro::pdfjsi;

namespace {

int failures = 0;
int passes = 0;
std::string dir;

void check(bool condition, const std::string& what) {
    if (condition) {
        passes++;
    } else {
        failures++;
        std::printf("FAIL: %s\n", what.c_str());
    }
}

std::string codeOf(const std::function<void()>& body) {
    try {
        body();
    } catch (const PdfException& error) {
        return error.code();
    } catch (const std::exception& error) {
        return std::string("other: ") + error.what();
    }
    return "none";
}

std::string fixture(const std::string& name) {
    return dir + "/" + name;
}

bool exists(const std::string& path) {
    struct stat info {};
    return stat(path.c_str(), &info) == 0 && info.st_size > 0;
}

void testOpen() {
    check(codeOf([] { OpenPdf pdf(fixture("missing.pdf"), std::nullopt); }) == "invalid-source", "missing file is invalid-source");
    check(codeOf([] { OpenPdf pdf(fixture("encrypted.pdf"), std::nullopt); }) == "password-required", "no password is password-required");
    check(codeOf([] { OpenPdf pdf(fixture("encrypted.pdf"), std::string("wrong")); }) == "password-incorrect", "wrong password is password-incorrect");
    check(codeOf([] { OpenPdf pdf(fixture("encrypted.pdf"), std::string("")); }) == "password-required", "empty password is password-required");
    OpenPdf pdf(fixture("encrypted.pdf"), std::string("secret"));
    check(pdf.pageCount() == 2, "encrypted opens with the password");
    check(pdf.isEncrypted(), "encrypted reports isEncrypted");
    check(pdf.textFromPage(0).find("Secret page 1") != std::string::npos, "encrypted text is readable");
    OpenPdf plain(fixture("sample.pdf"), std::string("ignored"));
    check(!plain.isEncrypted(), "a password on a plain PDF is ignored");
    check(codeOf([] {
        FILE* file = std::fopen(fixture("garbage.pdf").c_str(), "wb");
        std::fputs("not a pdf at all", file);
        std::fclose(file);
        OpenPdf bad(fixture("garbage.pdf"), std::nullopt);
    }) == "unsupported-pdf", "garbage is unsupported-pdf");
}

void testGeometryAndSearch() {
    OpenPdf pdf(fixture("sample.pdf"), std::nullopt);
    check(pdf.pageCount() == 5, "sample has 5 pages");
    PageGeometry first = pdf.geometry(0);
    check(first.width == 612 && first.height == 792 && first.rotation == 0, "page 0 is 612x792");
    PageGeometry rotated = pdf.geometry(1);
    check(rotated.width == 792 && rotated.height == 612 && rotated.rotation == 90, "page 1 is rotated 90");
    check(codeOf([&] { pdf.geometry(5); }) == "invalid-page", "geometry(5) is invalid-page");
    check(codeOf([&] { pdf.geometry(-1); }) == "invalid-page", "geometry(-1) is invalid-page");

    std::vector<SearchResult> results = pdf.search("Needle", 0, 4);
    check(results.size() == 5, "Needle found once per page");
    if (!results.empty()) {
        const PdfRect& rect = results[0].rect;
        // Drawn at baseline y=578 (from the bottom) in 14pt on a 792pt page.
        check(rect.x > 70 && rect.x < 75, "search rect x is near 72");
        check(rect.y > 792 - 578 - 16 && rect.y < 792 - 578 + 2, "search rect y is top-left based");
        check(rect.width > 30 && rect.height > 5 && rect.height < 20, "search rect has a plausible size");
    }
    std::vector<SearchResult> range = pdf.search("Needle", 3, 1);
    check(range.size() == 3, "reversed range searches pages 1-3");
    if (results.size() > 1) {
        const PdfRect& onRotated = results[1].rect;
        check(onRotated.width < onRotated.height, "search rect on a rotated page is rotated");
    }

    std::vector<OutlineItem> outline = pdf.outline();
    check(outline.size() == 3, "outline has 3 items");
    if (outline.size() == 3) {
        check(outline[0].title == "Introduction" && outline[0].page == 0 && outline[0].level == 0, "outline item 0");
        check(outline[2].title == "Section 2.1" && outline[2].page == 2 && outline[2].level == 1, "outline nested item");
    }

    std::vector<PageLink> links = pdf.links(0);
    check(links.size() == 2, "page 0 has 2 links");
    if (links.size() == 2) {
        check(links[0].page == 2, "internal link targets page 2");
        check(links[1].uri == "https://example.com/", "URI link");
        check(std::fabs(links[0].rect.y - (792 - 530)) < 1, "link rect is top-left based");
    }
}

void testRender() {
    OpenPdf pdf(fixture("sample.pdf"), std::nullopt);
    setRenderDirectory(dir + "/renders");
    RenderRequest request;
    request.maxWidth = 300;
    RenderedImage image = pdf.render(0, request);
    check(image.width == 300 && image.height == 388, "maxWidth keeps the aspect ratio");
    check(exists(image.path) && image.uri == "file://" + image.path, "render writes a file");
    request = RenderRequest();
    request.scale = 1;
    request.png = true;
    request.outputPath = dir + "/out/page1.png";
    image = pdf.render(1, request);
    check(image.width == 792 && image.height == 612 && exists(dir + "/out/page1.png"), "png at scale 1 with outputPath");
    request = RenderRequest();
    request.maxWidth = 100;
    request.maxHeight = 100;
    image = pdf.render(0, request);
    check(image.height == 100 && image.width == 77, "fits inside maxWidth and maxHeight");
    check(codeOf([&] { pdf.render(9, RenderRequest()); }) == "invalid-page", "render(9) is invalid-page");

    std::vector<uint32_t> pixels(64 * 64, 0);
    pdf.renderRegion(0, pixels.data(), 64 * 4, 64, 64, 612, 792, 0, 0, 0xFFFF0000);
    check((pixels[0] & 0xFF) == 0xFF && ((pixels[0] >> 16) & 0xFF) == 0, "renderRegion fills RGBA background");
}

void testEditing() {
    OpenPdf pdf(fixture("sample.pdf"), std::nullopt);
    check(!pdf.hasUnsavedChanges(), "fresh document is clean");
    pdf.rotate(0, 90);
    check(pdf.geometry(0).rotation == 90 && pdf.hasUnsavedChanges(), "rotate is relative and marks dirty");
    pdf.rotate(0, -180);
    check(pdf.geometry(0).rotation == 270, "negative rotation wraps");
    check(codeOf([&] { pdf.rotate(0, 45); }) == "invalid-argument", "rotate 45 is invalid-argument");

    pdf.movePage(4, 0);
    check(pdf.textFromPage(0).find("Page 5") != std::string::npos, "movePage(4,0) puts page 5 first");
    pdf.removePage(0);
    check(pdf.pageCount() == 4 && pdf.textFromPage(0).find("Page 1") != std::string::npos, "removePage(0)");
    pdf.insertPages(fixture("encrypted.pdf"), 1, {1}, std::string("secret"));
    check(pdf.pageCount() == 5 && pdf.textFromPage(1).find("Secret page 2") != std::string::npos, "insertPages from an encrypted PDF");
    check(codeOf([&] { pdf.insertPages(fixture("encrypted.pdf"), 0, {}, std::nullopt); }) == "password-required",
          "insertPages without a password");
    check(codeOf([&] { pdf.insertPages(fixture("sample.pdf"), 99, {}, std::nullopt); }) == "invalid-page",
          "insertPages past the end");

    AnnotationInput highlight(0, AddableAnnotationType::HIGHLIGHT, PdfRect(72, 100, 200, 20), std::string("#FF000080"),
                              std::string("note text"), std::nullopt);
    const int index = pdf.addAnnotation(highlight);
    std::vector<PdfAnnotation> annotations = pdf.annotations(0);
    check(index >= 0 && static_cast<size_t>(index) < annotations.size(), "addAnnotation returns its index");
    if (index >= 0 && static_cast<size_t>(index) < annotations.size()) {
        const PdfAnnotation& added = annotations[index];
        check(added.type == AnnotationType::HIGHLIGHT, "annotation type round-trips");
        check(std::fabs(added.rect.x - 72) < 0.5 && std::fabs(added.rect.y - 100) < 0.5 &&
                  std::fabs(added.rect.width - 200) < 0.5,
              "annotation rect round-trips");
        check(added.color == "#FF000080", "annotation colour round-trips");
        check(added.contents == "note text", "annotation contents round-trip");
    }
    AnnotationInput ink(2, AddableAnnotationType::INK, PdfRect(50, 50, 100, 100), std::nullopt, std::nullopt,
                        std::vector<InkStroke> {InkStroke({PdfPoint(60, 60), PdfPoint(140, 140)})});
    pdf.addAnnotation(ink);
    AnnotationInput stamp(2, AddableAnnotationType::STAMP, PdfRect(300, 50, 150, 50), std::nullopt, std::string("APPROVED"),
                          std::nullopt);
    pdf.addAnnotation(stamp);
    check(pdf.annotations(2).size() == 2, "ink and stamp added");
    check(codeOf([&] {
        pdf.addAnnotation(AnnotationInput(0, AddableAnnotationType::INK, PdfRect(0, 0, 10, 10), std::nullopt, std::nullopt, std::nullopt));
    }) == "invalid-argument", "ink without strokes is invalid-argument");
    pdf.removeAnnotation(0, index);
    check(pdf.annotations(0).size() == annotations.size() - 1, "removeAnnotation");
    check(codeOf([&] { pdf.removeAnnotation(0, 99); }) == "invalid-argument", "removeAnnotation(99)");

    const std::string saved = dir + "/out/edited.pdf";
    check(pdf.save(saved) == saved && !pdf.hasUnsavedChanges(), "save writes and clears dirty");
    OpenPdf reopened(saved, std::nullopt);
    check(reopened.pageCount() == 5, "saved page count");
    check(reopened.geometry(0).rotation == 270, "saved keeps rotation");
    check(reopened.textFromPage(1).find("Secret page 2") != std::string::npos, "saved keeps inserted page");
    check(reopened.annotations(2).size() == 2, "saved keeps annotations");
    check(!reopened.isEncrypted(), "saved copy of inserted encrypted pages is not encrypted");

    const std::string inPlace = dir + "/out/in-place.pdf";
    {
        OpenPdf copy(fixture("sample.pdf"), std::nullopt);
        copy.save(inPlace);
    }
    OpenPdf target(inPlace, std::nullopt);
    target.removePage(0);
    target.save(inPlace);
    check(target.pageCount() == 4 && target.textFromPage(0).find("Page 2") != std::string::npos, "document stays usable after saving over its own file");
    OpenPdf check4(inPlace, std::nullopt);
    check(check4.pageCount() == 4, "saving over the source file");

    OpenPdf single(fixture("encrypted.pdf"), std::string("secret"));
    single.removePage(0);
    check(codeOf([&] { single.removePage(0); }) == "invalid-argument", "cannot delete the only page");
}

void testForms() {
    OpenPdf pdf(fixture("form.pdf"), std::nullopt);
    std::vector<PdfFormField> fields = pdf.formFields();
    check(fields.size() == 3, "form has 3 fields");
    auto find = [&](const std::vector<PdfFormField>& list, const std::string& name) -> const PdfFormField* {
        for (const PdfFormField& field : list) {
            if (field.name == name) {
                return &field;
            }
        }
        return nullptr;
    };
    const PdfFormField* name = find(fields, "name");
    const PdfFormField* agree = find(fields, "agree");
    const PdfFormField* color = find(fields, "color");
    check(name != nullptr && name->type == FormFieldType::TEXT, "text field");
    check(agree != nullptr && agree->type == FormFieldType::CHECKBOX && !agree->checked, "checkbox unchecked");
    check(color != nullptr && color->type == FormFieldType::COMBOBOX && color->options.size() == 3 && color->value == "Red",
          "combobox with options");

    pdf.setFormValues({{"name", "Ada Lovelace"}, {"agree", "true"}, {"color", "Blue"}});
    fields = pdf.formFields();
    name = find(fields, "name");
    agree = find(fields, "agree");
    color = find(fields, "color");
    check(name != nullptr && name->value == "Ada Lovelace", "text value set");
    check(agree != nullptr && agree->checked, "checkbox checked");
    check(color != nullptr && color->value == "Blue", "combobox value set");
    check(pdf.hasUnsavedChanges(), "form edits mark dirty");
    check(codeOf([&] { pdf.setFormValues({{"nope", "x"}}); }) == "invalid-argument", "unknown field is invalid-argument");

    const std::string saved = dir + "/out/form-filled.pdf";
    pdf.save(saved);
    OpenPdf reopened(saved, std::nullopt);
    std::vector<PdfFormField> again = reopened.formFields();
    const PdfFormField* savedName = find(again, "name");
    check(savedName != nullptr && savedName->value == "Ada Lovelace", "form values survive save");

    reopened.flattenForms();
    check(reopened.formFields().empty(), "flatten removes form fields");
    check(reopened.textFromPage(0).find("Ada Lovelace") != std::string::npos, "flattened value is page text");

    OpenPdf plain(fixture("sample.pdf"), std::nullopt);
    check(plain.formFields().empty(), "no fields in a plain PDF");
}

void testLibrary() {
    const std::string merged = pdfiumMerge({fixture("sample.pdf"), fixture("pages-10.pdf")}, dir + "/out/merged.pdf");
    OpenPdf mergedPdf(merged, std::nullopt);
    check(mergedPdf.pageCount() == 15, "merge 5 + 10 pages");
    check(codeOf([] { pdfiumMerge({fixture("sample.pdf")}, ""); }) == "invalid-argument", "merge needs 2 files");
    check(codeOf([] { pdfiumMerge({fixture("sample.pdf"), fixture("encrypted.pdf")}, ""); }) == "password-required",
          "merge with an encrypted file");
    const std::string split = pdfiumSplit(fixture("pages-10.pdf"), "[[0,1],[5,9]]", dir + "/out");
    check(split.find("split-0-1") != std::string::npos && split.find("split-5-9") != std::string::npos, "split ranges");
    check(codeOf([] { pdfiumSplit(fixture("pages-10.pdf"), "[[5,20]]", dir + "/out"); }) == "invalid-page", "split out of range");
    const std::string extracted = pdfiumExtract(fixture("pages-10.pdf"), "[9,0]", dir + "/out/extract.pdf");
    OpenPdf extractedPdf(extracted, std::nullopt);
    check(extractedPdf.pageCount() == 2 && extractedPdf.textFromPage(0).find("Page 10") != std::string::npos,
          "extract keeps the requested order");
}

} // namespace

int main(int argc, char** argv) {
    dir = argc > 1 ? argv[1] : ".";
    mkdir((dir + "/out").c_str(), 0755);
    pdfiumInit();
    const std::vector<std::pair<const char*, void (*)()>> tests = {
        {"open", testOpen},     {"geometry", testGeometryAndSearch}, {"render", testRender},
        {"editing", testEditing}, {"forms", testForms},             {"library", testLibrary},
    };
    for (const auto& [name, test] : tests) {
        try {
            test();
        } catch (const std::exception& error) {
            failures++;
            std::printf("FAIL: %s threw %s\n", name, error.what());
        }
    }
    std::printf("%d passed, %d failed\n", passes, failures);
    return failures == 0 ? 0 : 1;
}
