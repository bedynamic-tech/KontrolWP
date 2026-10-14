import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftIcon,
  BoldIcon,
  CodeIcon,
  ImageIcon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  QuoteIcon,
  TvIcon,
  UnlinkIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { CreatedPost, NewPost, PostForm, SiteSummary, UploadedImage } from "../../shared/types";
import { createPost, fetchPostForm, uploadImage } from "../api";
import { SELECT_CLASS } from "./AnalyticsSection";
import { readBase64 } from "./BrandingTab";
import { EditButton } from "./LinksTab";
import { EmptyRow, Section } from "./Section";
import { HelpTip } from "./HelpTip";
import { IconButton } from "./IconButton";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"];

const BLOCKS = [
  { tag: "p", label: "Paragraph" },
  { tag: "h2", label: "Heading 2" },
  { tag: "h3", label: "Heading 3" },
  { tag: "h4", label: "Heading 4" },
  { tag: "pre", label: "Code block" },
];

const FALLBACK_FORM: PostForm = {
  types: [
    { slug: "post", singular: "Post", categories: false, tags: false, featured: false },
    { slug: "page", singular: "Page", categories: false, tags: false, featured: false },
  ],
  authors: [],
  default_author: 0,
  categories: [],
  max_upload: 2 * 1048576,
};

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function imageHtml(image: UploadedImage, alt: string): string {
  const size = image.width && image.height ? ` width="${image.width}" height="${image.height}"` : "";
  return `<p><img class="wp-image-${image.id} size-large" src="${escapeHtml(image.src)}" alt="${escapeHtml(alt)}"${size}></p>`;
}

/** One block per line, so the HTML view is readable. */
const tidy = (html: string) =>
  html.replace(/(<\/(p|h[1-6]|ul|ol|li|blockquote|pre|figure|div)>)(?!\n)/g, "$1\n").trim();

const megabytes = (bytes: number) => `${Math.round((bytes / 1048576) * 10) / 10} MB`;

/** The visual editor's page, in the dashboard's colours. Its content is set once it loads. */
function editorPage(): string {
  const css = getComputedStyle(document.documentElement);
  const color = (name: string) => css.getPropertyValue(name).trim();
  const font = getComputedStyle(document.body).fontFamily;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html { color-scheme: ${document.documentElement.classList.contains("dark") ? "dark" : "light"}; }
    body { margin: 0; padding: 12px 16px; min-height: calc(100vh - 24px); box-sizing: border-box; font: 15px/1.6 ${font};
      color: ${color("--foreground")}; background: ${color("--background")}; outline: none; overflow-wrap: break-word; }
    a { color: ${color("--primary")}; }
    img, iframe, video { max-width: 100%; height: auto; }
    blockquote { margin: 0 0 1em; padding-left: 12px; border-left: 3px solid ${color("--border")}; color: ${color("--muted-foreground")}; }
    pre { white-space: pre-wrap; padding: 8px 12px; border-radius: 8px; background: ${color("--muted")}; font-size: 13px; }
    p, ul, ol, h2, h3, h4 { margin: 0 0 0.75em; }
  </style></head><body contenteditable="true" spellcheck="true"></body></html>`;
}

type Mode = "visual" | "html";

/**
 * The post body: a visual editor or its HTML. The visual editor is a sandboxed frame with
 * scripts off, so HTML pasted or typed into the post never runs in the dashboard.
 */
function BodyEditor(props: {
  html: string;
  onChange: (html: string) => void;
  onAddImage: () => void;
  onAddLink: () => void;
  onAddEmbed: () => void;
  onDropImages: (files: File[]) => void;
  register: (insert: Inserter) => void;
}) {
  const { html, onChange } = props;
  const [mode, setMode] = useState<Mode>("visual");
  const [block, setBlock] = useState("p");
  const [theme, setTheme] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const latest = useRef(html);
  latest.current = html;

  // A theme change redraws the frame in the new colours, keeping what was written.
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme((value) => value + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const doc = () => frame.current?.contentDocument ?? null;

  function read() {
    const body = doc()?.body;
    if (!body) return;
    const empty = !body.textContent?.trim() && !body.querySelector("img, iframe, video, hr, embed, object");
    onChange(empty ? "" : body.innerHTML);
  }

  function updateBlock() {
    const value = String(doc()?.queryCommandValue("formatBlock") ?? "").toLowerCase();
    setBlock(BLOCKS.some((item) => item.tag === value) ? value : "p");
  }

  function load() {
    const d = doc();
    if (!d) return;
    d.body.innerHTML = latest.current || "<p><br></p>";
    d.execCommand("defaultParagraphSeparator", false, "p");
    d.execCommand("styleWithCSS", false, "false");
    d.addEventListener("input", read);
    d.addEventListener("keyup", updateBlock);
    d.addEventListener("mouseup", updateBlock);
    const takeImages = (event: ClipboardEvent | DragEvent, list: FileList | undefined | null) => {
      const files = Array.from(list ?? []).filter((file) => IMAGE_TYPES.includes(file.type));
      if (!files.length) return;
      event.preventDefault();
      props.onDropImages(files);
    };
    d.addEventListener("paste", (event) => takeImages(event, event.clipboardData?.files));
    d.addEventListener("drop", (event) => takeImages(event, event.dataTransfer?.files));
  }

  function command(name: string, value?: string) {
    const d = doc();
    if (!d) return;
    frame.current?.contentWindow?.focus();
    d.body.focus();
    d.execCommand(name, false, value);
    read();
    updateBlock();
  }

  /** Put HTML where the cursor is, in either view. */
  function insert(snippet: string) {
    if (mode === "visual") {
      insertBlock(snippet);
      return;
    }
    const area = textarea.current;
    const start = area?.selectionStart ?? html.length;
    const end = area?.selectionEnd ?? html.length;
    const before = html.slice(0, start);
    const glue = before && !before.endsWith("\n") ? "\n" : "";
    onChange(`${before}${glue}${snippet}\n${html.slice(end)}`);
  }
  /** Add a block (an image, an embed) after the one the cursor is in, not inside it. */
  function insertBlock(snippet: string) {
    const d = doc();
    if (!d) return;
    const selection = d.getSelection();
    let block: Node | null = selection?.rangeCount ? selection.getRangeAt(0).endContainer : null;
    while (block && block.parentNode !== d.body) block = block.parentNode;
    const range = d.createRange();
    range.selectNodeContents(d.body);
    const fragment = range.createContextualFragment(snippet);
    const last = fragment.lastChild;
    // The frame's nodes come from its own window, so check the node type rather than instanceof.
    const empty =
      block?.nodeType === Node.ELEMENT_NODE && !block.textContent?.trim() && !(block as Element).querySelector("img, iframe");
    if (block && empty) d.body.replaceChild(fragment, block);
    else if (block) d.body.insertBefore(fragment, block.nextSibling);
    else d.body.appendChild(fragment);
    // Leave an empty paragraph after it to keep writing in.
    const next = d.createElement("p");
    next.appendChild(d.createElement("br"));
    if (last) d.body.insertBefore(next, last.nextSibling);
    frame.current?.contentWindow?.focus();
    d.body.focus();
    selection?.collapse(next, 0);
    read();
  }

  function link(url: string) {
    const selection = doc()?.getSelection();
    if (selection && !selection.isCollapsed) command("createLink", url);
    else command("insertHTML", `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`);
  }
  props.register({ insert, link });

  function switchTo(next: Mode) {
    if (next === mode) return;
    if (next === "html") onChange(tidy(html));
    setMode(next);
  }

  const visual = mode === "visual";
  return (
    <div className="overflow-hidden rounded-xl border bg-background">
      <div
        className="flex flex-wrap items-center gap-2 border-b bg-muted/40 p-2"
        // Clicking a toolbar button keeps the cursor and selection in the text.
        onMouseDown={(event) => {
          if ((event.target as HTMLElement).closest("button")) event.preventDefault();
        }}
      >
        <div className="flex gap-2" role="group" aria-label="Editor view">
          {(["visual", "html"] as const).map((value) => (
            <Button
              key={value}
              size="sm"
              variant={mode === value ? "secondary" : "ghost"}
              aria-pressed={mode === value}
              onClick={() => switchTo(value)}
            >
              {value === "visual" ? "Visual" : "HTML"}
            </Button>
          ))}
        </div>
        {visual && (
          <>
            <select
              aria-label="Block format"
              className={cn(SELECT_CLASS, "w-auto")}
              value={block}
              onChange={(event) => command("formatBlock", event.target.value)}
            >
              {BLOCKS.map((item) => (
                <option key={item.tag} value={item.tag}>
                  {item.label}
                </option>
              ))}
            </select>
            <IconButton label="Bold" variant="ghost" onClick={() => command("bold")}>
              <BoldIcon />
            </IconButton>
            <IconButton label="Italic" variant="ghost" onClick={() => command("italic")}>
              <ItalicIcon />
            </IconButton>
            <IconButton label="Bulleted list" variant="ghost" onClick={() => command("insertUnorderedList")}>
              <ListIcon />
            </IconButton>
            <IconButton label="Numbered list" variant="ghost" onClick={() => command("insertOrderedList")}>
              <ListOrderedIcon />
            </IconButton>
            <IconButton label="Quote" variant="ghost" onClick={() => command("formatBlock", "blockquote")}>
              <QuoteIcon />
            </IconButton>
            <IconButton label="Inline code" variant="ghost" onClick={() => command("insertHTML", `<code>${escapeHtml(doc()?.getSelection()?.toString() || "code")}</code>`)}>
              <CodeIcon />
            </IconButton>
            <IconButton label="Add link" variant="ghost" onClick={props.onAddLink}>
              <LinkIcon />
            </IconButton>
            <IconButton label="Remove link" variant="ghost" onClick={() => command("unlink")}>
              <UnlinkIcon />
            </IconButton>
          </>
        )}
        <IconButton label="Add image" variant="ghost" onClick={props.onAddImage}>
          <ImageIcon />
        </IconButton>
        <IconButton label="Embed a video or post" variant="ghost" onClick={props.onAddEmbed}>
          <TvIcon />
        </IconButton>
      </div>
      {visual ? (
        <iframe
          key={theme}
          ref={frame}
          title="Post content"
          sandbox="allow-same-origin"
          srcDoc={editorPage()}
          onLoad={load}
          className="block h-96 w-full bg-background"
        />
      ) : (
        <Textarea
          ref={textarea}
          aria-label="Post HTML"
          value={html}
          onChange={(event) => onChange(event.target.value)}
          spellCheck={false}
          className="block h-96 resize-y rounded-none border-0 font-mono text-xs focus-visible:ring-0"
        />
      )}
    </div>
  );
}

interface Inserter {
  insert: (html: string) => void;
  link: (url: string) => void;
}

/** A dialog that asks for one address. */
function UrlDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  label: string;
  action: string;
  onSubmit: (url: string) => void;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (props.open) setUrl("");
  }, [props.open]);
  const valid = /^(https?:\/\/|mailto:|\/|#)/i.test(url.trim());
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    props.onSubmit(url.trim());
    props.onOpenChange(false);
  }
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        className="sm:max-w-md [&>*]:min-w-0"
        // Focus goes back to the text, not to the toolbar button.
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <form onSubmit={submit} className="min-w-0 space-y-4">
          <DialogHeader>
            <DialogTitle>{props.title}</DialogTitle>
            <DialogDescription>{props.description}</DialogDescription>
          </DialogHeader>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">{props.label}</span>
            <Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://" autoFocus />
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid}>
              {props.action}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Choose an image and its alt text, upload it to the media library and hand it back. */
function ImageDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  action: string;
  upload: (file: File, alt: string) => Promise<UploadedImage>;
  onDone: (image: UploadedImage, alt: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [alt, setAlt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!props.open) return;
    setFile(null);
    setAlt("");
    setError("");
  }, [props.open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      props.onDone(await props.upload(file, alt.trim()), alt.trim());
      props.onOpenChange(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={(open) => !busy && props.onOpenChange(open)}>
      <DialogContent
        className="sm:max-w-md [&>*]:min-w-0"
        // Focus goes back to the text, not to the toolbar button.
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <form onSubmit={submit} className="min-w-0 space-y-4">
          <DialogHeader>
            <DialogTitle>{props.title}</DialogTitle>
            <DialogDescription>The image is added to the site's media library.</DialogDescription>
          </DialogHeader>
          <input
            ref={input}
            type="file"
            accept={IMAGE_TYPES.join(",")}
            className="hidden"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              event.target.value = "";
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()} disabled={busy}>
              {file ? "Choose another" : "Choose image"}
            </Button>
            {file && <span className="min-w-0 text-sm wrap-break-word text-muted-foreground">{file.name}</span>}
          </div>
          <label className="block space-y-1.5">
            <span className="flex items-center gap-1.5 text-sm font-medium">
              Alt text
              <HelpTip>Describes the image for people who cannot see it, and for search engines.</HelpTip>
            </span>
            <Input value={alt} onChange={(event) => setAlt(event.target.value)} maxLength={300} />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={!file || busy}>
              {busy ? "Uploading..." : props.action}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Categories in order, children indented under their parents. */
function categoryTree(categories: PostForm["categories"]) {
  const ids = new Set(categories.map((category) => category.id));
  const out: { id: number; name: string; depth: number }[] = [];
  const walk = (parent: number, depth: number) => {
    for (const category of categories) {
      const root = !category.parent || !ids.has(category.parent);
      if (parent === 0 ? !root : category.parent !== parent) continue;
      out.push({ id: category.id, name: category.name, depth });
      if (depth < 5) walk(category.id, depth + 1);
    }
  };
  walk(0, 0);
  return out;
}

function Field(props: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{props.label}</span>
      {props.children}
    </label>
  );
}

/** Posts and pages > New post: write a post or page and save it as a draft or publish it. */
export function PostEditor(props: { site: SiteSummary; onClose: () => void }) {
  const { site, onClose } = props;
  const queryClient = useQueryClient();
  const form = useQuery({
    queryKey: ["site", site.id, "post-form"],
    queryFn: () => fetchPostForm(site.id),
    refetchInterval: false,
  });
  const [type, setType] = useState("post");
  const [title, setTitle] = useState("");
  const [html, setHtml] = useState("");
  const [author, setAuthor] = useState(0);
  const [categories, setCategories] = useState<number[]>([]);
  const [tags, setTags] = useState("");
  const [featured, setFeatured] = useState<UploadedImage | null>(null);
  const [dialog, setDialog] = useState<"image" | "link" | "embed" | "featured" | "discard" | null>(null);
  const [notice, setNotice] = useState("");
  const [saved, setSaved] = useState<CreatedPost | null>(null);
  const inserter = useRef<Inserter | null>(null);

  const data = form.data;
  useEffect(() => {
    if (!data) return;
    setType((current) => (data.types.some((item) => item.slug === current) ? current : (data.types[0]?.slug ?? "post")));
    setAuthor((current) => {
      if (current) return current;
      const preferred = data.authors.find((item) => item.id === site.login_user_id);
      return preferred?.id ?? data.default_author;
    });
  }, [data, site.login_user_id]);

  async function upload(file: File, alt: string): Promise<UploadedImage> {
    if (!IMAGE_TYPES.includes(file.type)) throw new Error("Upload a JPEG, PNG, GIF, WebP or AVIF image.");
    const limit = (data ?? FALLBACK_FORM).max_upload;
    if (file.size > limit)
      throw new Error(`The image is ${megabytes(file.size)}. This site takes images up to ${megabytes(limit)}.`);
    return uploadImage(site.id, { name: file.name, image: await readBase64(file), alt: alt || undefined });
  }

  async function dropImages(files: File[]) {
    setNotice(`Uploading ${files.length === 1 ? "the image" : `${files.length} images`}...`);
    try {
      for (const file of files) inserter.current?.insert(imageHtml(await upload(file, ""), ""));
      setNotice("");
    } catch (failure) {
      setNotice(failure instanceof Error ? failure.message : String(failure));
    }
  }

  const save = useMutation({
    mutationFn: (status: NewPost["status"]) => {
      const kind = data?.types.find((item) => item.slug === type);
      return createPost(site.id, {
        type,
        title: title.trim(),
        content: html.replace(/(\s*<p>(\s|&nbsp;|<br\s*\/?>)*<\/p>)+\s*$/, "").trim(),
        status,
        author: author || undefined,
        categories: kind?.categories && categories.length ? categories : undefined,
        tags: kind?.tags ? tags.split(",").map((tag) => tag.trim()).filter(Boolean) : undefined,
        featured: kind?.featured && featured ? featured.id : undefined,
      });
    },
    onSuccess: (created) => {
      setSaved(created);
      queryClient.invalidateQueries({ queryKey: ["site", site.id, "content"] });
    },
  });

  function reset() {
    setTitle("");
    setHtml("");
    setCategories([]);
    setTags("");
    setFeatured(null);
    setSaved(null);
    save.reset();
  }

  const back = (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => (title.trim() || html.trim()) && !saved ? setDialog("discard") : onClose()}
    >
      <ArrowLeftIcon /> Posts and pages
    </Button>
  );

  if (form.isPending) {
    return (
      <div className="mt-8 space-y-3">
        {back}
        <Section title="New post">
          <EmptyRow>Loading...</EmptyRow>
        </Section>
      </div>
    );
  }
  // Without the site's choices the editor still works, as a post or page by the site's first administrator.
  const options = form.data ?? FALLBACK_FORM;
  const kind = options.types.find((item) => item.slug === type);
  const singular = kind?.singular ?? "Post";

  if (saved) {
    const published = saved.status === "publish";
    return (
      <div className="mt-8 space-y-3">
        {back}
        <Section title={published ? `${singular} published` : "Draft saved"}>
          <div className="space-y-4 px-4 py-6 text-sm">
            <p className="wrap-break-word">
              <span className="font-medium">{title.trim() || "(no title)"}</span>{" "}
              {published ? "is live on the site." : "is saved as a draft on the site."}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" asChild>
                <a href={saved.permalink} target="_blank" rel="noreferrer noopener">
                  {published ? "View on the site" : "Preview on the site"}
                </a>
              </Button>
              <EditButton site={site} postId={saved.id} />
              <Button size="sm" variant="outline" onClick={reset}>
                Write another
              </Button>
              <Button size="sm" onClick={onClose}>
                Done
              </Button>
            </div>
          </div>
        </Section>
      </div>
    );
  }

  const tree = categoryTree(options.categories);
  const busy = save.isPending;
  const canPublish = !!title.trim();

  return (
    <div className="mt-8 space-y-3">
      {back}
      <h2 className="text-sm font-medium">New {singular.toLowerCase()}</h2>
      {form.error && (
        <p className="text-sm text-destructive">
          The site's categories and authors could not be read: {form.error.message}
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="min-w-0 space-y-3">
          <Input
            aria-label="Title"
            placeholder="Title"
            value={title}
            maxLength={1000}
            onChange={(event) => setTitle(event.target.value)}
            className="h-10 text-base"
          />
          <BodyEditor
            html={html}
            onChange={setHtml}
            onAddImage={() => setDialog("image")}
            onAddLink={() => setDialog("link")}
            onAddEmbed={() => setDialog("embed")}
            onDropImages={dropImages}
            register={(value) => {
              inserter.current = value;
            }}
          />
          {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
        </div>
        <div className="min-w-0 space-y-4 self-start rounded-xl border bg-background p-4">
          {options.types.length > 1 && (
            <Field label="Type">
              <select
                className={cn(SELECT_CLASS, "sm:w-full")}
                value={type}
                onChange={(event) => setType(event.target.value)}
              >
                {options.types.map((item) => (
                  <option key={item.slug} value={item.slug}>
                    {item.singular}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {options.authors.length > 0 && (
            <Field label="Author">
              <select
                className={cn(SELECT_CLASS, "sm:w-full")}
                value={author}
                onChange={(event) => setAuthor(Number(event.target.value))}
              >
                {options.authors.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {kind?.categories && tree.length > 0 && (
            <fieldset className="space-y-1.5">
              <legend className="mb-1.5 text-sm font-medium">Categories</legend>
              <div className="max-h-48 space-y-2 overflow-y-auto">
                {tree.map((category) => (
                  <label
                    key={category.id}
                    className="flex items-start gap-2 text-sm"
                    style={{ paddingLeft: category.depth * 16 }}
                  >
                    <Checkbox
                      className="mt-0.5"
                      checked={categories.includes(category.id)}
                      onChange={(event) =>
                        setCategories((current) =>
                          event.target.checked
                            ? [...current, category.id]
                            : current.filter((id) => id !== category.id),
                        )
                      }
                    />
                    <span className="min-w-0 wrap-break-word">{category.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {kind?.tags && (
            <Field label="Tags">
              <Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Separate with commas" />
            </Field>
          )}
          {kind?.featured && (
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Featured image</p>
              {featured && (
                <img src={featured.src} alt="Featured" className="max-h-40 w-full rounded-lg border object-cover" />
              )}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setDialog("featured")}>
                  {featured ? "Replace" : "Choose image"}
                </Button>
                {featured && (
                  <Button size="sm" variant="ghost" onClick={() => setFeatured(null)}>
                    Remove
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      {save.error && <p className="text-sm text-destructive">{save.error.message}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" disabled={busy || !(title.trim() || html.trim())} onClick={() => save.mutate("draft")}>
          {busy && save.variables === "draft" ? "Saving..." : "Save draft"}
        </Button>
        <Button disabled={busy || !canPublish} onClick={() => save.mutate("publish")}>
          {busy && save.variables === "publish" ? "Publishing..." : "Publish"}
        </Button>
      </div>

      <ImageDialog
        open={dialog === "image"}
        onOpenChange={(open) => setDialog(open ? "image" : null)}
        title="Add image"
        action="Upload and add"
        upload={upload}
        onDone={(image, alt) => inserter.current?.insert(imageHtml(image, alt))}
      />
      <ImageDialog
        open={dialog === "featured"}
        onOpenChange={(open) => setDialog(open ? "featured" : null)}
        title="Featured image"
        action="Upload"
        upload={upload}
        onDone={(image) => setFeatured(image)}
      />
      <UrlDialog
        open={dialog === "link"}
        onOpenChange={(open) => setDialog(open ? "link" : null)}
        title="Add link"
        description="Links the selected text. With nothing selected, the address itself is added."
        label="Address"
        action="Add link"
        onSubmit={(url) => inserter.current?.link(url)}
      />
      <UrlDialog
        open={dialog === "embed"}
        onOpenChange={(open) => setDialog(open ? "embed" : null)}
        title="Embed"
        description="Paste a YouTube, Vimeo, Spotify, X or other address WordPress can embed. It shows as an address here and as the embed on the site."
        label="Address"
        action="Embed"
        onSubmit={(url) => inserter.current?.insert(`<p>${escapeHtml(url)}</p>`)}
      />
      <Dialog open={dialog === "discard"} onOpenChange={(open) => setDialog(open ? "discard" : null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Discard this {singular.toLowerCase()}?</DialogTitle>
            <DialogDescription>It has not been saved to the site.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              Keep writing
            </Button>
            <Button variant="destructive" onClick={onClose}>
              Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
