/**
 * Platforms backed by the current syndication backend. Brightcove / WeTransfer
 * from the original mockup are intentionally excluded (no backend support yet,
 * see docs/syndication_new_design.md).
 */
export type SyndicationPlatform = "youtube" | "facebook" | "instagram" | "twitter" | "tiktok";

export const SYNDICATION_PLATFORM_ORDER: SyndicationPlatform[] = [
  "youtube",
  "facebook",
  "instagram",
  "twitter",
  "tiktok",
];

type PlatformMeta = {
  label: string;
  /** Short label used inside the account group filter chips. */
  shortLabel: string;
  /** Brand glyph shown inside the colored platform badge (matches the mockup). */
  glyph: string;
  /** Brand background used for the small platform badge. */
  iconBg: string;
  /** OAuth consent bullet points shown in the connect modal. */
  permissions: string[];
  /** Copy for the connect tile. */
  connectDescription: string;
};

export const SYNDICATION_PLATFORM_META: Record<SyndicationPlatform, PlatformMeta> = {
  youtube: {
    label: "YouTube",
    shortLabel: "YouTube",
    glyph: "▶",
    iconBg: "#e1251b",
    connectDescription: "Channel, with Content ID if linked to a CMS",
    permissions: ["Upload videos and thumbnails", "Add captions and playlists", "Read channel details"],
  },
  facebook: {
    label: "Facebook",
    shortLabel: "Facebook",
    glyph: "f",
    iconBg: "#1877f2",
    connectDescription: "Pages you manage",
    permissions: ["Post videos and Reels to your pages", "Read page names and pictures"],
  },
  instagram: {
    label: "Instagram",
    shortLabel: "Instagram",
    glyph: "IG",
    iconBg: "#c1358a",
    connectDescription: "Business or creator accounts linked to a page",
    permissions: ["Post Reels and Stories to linked Instagram accounts", "Read account details"],
  },
  twitter: {
    label: "X (Twitter)",
    shortLabel: "X",
    glyph: "X",
    iconBg: "#14171a",
    connectDescription: "One X account per connection",
    permissions: ["Post and reply for this account", "Upload videos", "Read profile details"],
  },
  tiktok: {
    label: "TikTok",
    shortLabel: "TikTok",
    glyph: "TT",
    iconBg: "#111111",
    connectDescription: "Business or creator accounts",
    permissions: ["Post videos or send drafts to the app", "Read profile details"],
  },
};

/** A single configurable field inside a settings card. */
export type SyndField =
  | { kind: "info"; label: string; value: string; help?: string }
  | { kind: "select"; id: string; label: string; options: string[]; default: string; help?: string }
  | { kind: "segment"; id: string; label: string; options: string[]; default: string; help?: string }
  | { kind: "toggle"; id: string; label: string; default: boolean; help?: string }
  | { kind: "text"; id: string; label: string; default: string; help?: string; placeholder?: string }
  | { kind: "textarea"; id: string; label: string; default: string; help?: string; tokens?: string[] }
  | { kind: "chips"; id: string; label: string; default: string[]; help?: string; placeholder?: string };

export type SyndCard = {
  id: string;
  title: string;
  subtitle?: string;
  /** Optional platform icon badge rendered in the card header. */
  platform?: SyndicationPlatform;
  note?: string;
  fields: SyndField[];
};

export type SyndicationAccountLike = {
  id: string;
  displayName: string;
  platform: SyndicationPlatform;
  /** Best-effort language hint; defaults to "All languages". */
  language?: string;
};

const LANGS = ["Arabic", "English", "Hebrew", "French", "Spanish"];

function generalCard(account: SyndicationAccountLike): SyndCard {
  return {
    id: "general",
    title: "General",
    subtitle: "Who can post here and how it shows in the CMS",
    fields: [
      {
        kind: "text",
        id: "display",
        label: "Name in the CMS",
        default: account.displayName,
        help: "What editors see in the Syndication tab",
      },
      {
        kind: "select",
        id: "lang",
        label: "Account language",
        options: [...LANGS, "All languages"],
        default: account.language || "All languages",
        help: "Suggests this account for clips in this language",
      },
      {
        kind: "chips",
        id: "who",
        label: "Who can post",
        default: [],
        help: "User groups that can choose this account",
        placeholder: "Add group…",
      },
      {
        kind: "toggle",
        id: "approval",
        label: "Approval before posting",
        default: account.platform === "youtube",
        help: "Posts wait in “Pending approval” until an editor approves them",
      },
      { kind: "toggle", id: "active", label: "Show in the Syndication tab", default: true },
      { kind: "toggle", id: "alerts", label: "Email the team if a post fails", default: true },
    ],
  };
}

function mediaCard(account: SyndicationAccountLike): SyndCard {
  const k = account.platform;
  const ratioOpts: Record<SyndicationPlatform, string[]> = {
    youtube: ["Keep original", "16:9", "9:16 (Shorts)"],
    facebook: ["Keep original", "4:5", "1:1", "9:16"],
    instagram: ["Keep original", "4:5", "1:1", "9:16"],
    twitter: ["Keep original", "16:9", "1:1"],
    tiktok: ["9:16", "Keep original"],
  };
  const ratioDef =
    k === "facebook" || k === "instagram" ? "4:5" : k === "tiktok" ? "9:16" : "Keep original";
  const subOpts =
    k === "tiktok"
      ? ["Burn into the video", "Don’t add"]
      : ["Upload as a captions file", "Burn into the video", "Don’t add"];
  const subLang = [`Same as the account (${account.language || "account"})`, ...LANGS];

  return {
    id: "media",
    title: "Video and image",
    subtitle: "What we send with every post",
    fields: [
      {
        kind: "select",
        id: "video",
        label: "Video to send",
        options: ["Default video element", "Highest-quality MP4", "Choose in every post"],
        default: "Default video element",
      },
      { kind: "segment", id: "ratio", label: "Aspect ratio", options: ratioOpts[k], default: ratioDef },
      {
        kind: "select",
        id: "crop",
        label: "If the clip has another ratio",
        options: ["Smart crop (keeps faces in frame)", "Center crop", "Add blurred bars"],
        default: "Smart crop (keeps faces in frame)",
      },
      { kind: "select", id: "subs", label: "Subtitles", options: subOpts, default: subOpts[0] },
      { kind: "select", id: "subLang", label: "Subtitle language", options: subLang, default: subLang[0] },
      {
        kind: "select",
        id: "logo",
        label: "Logo on the video",
        options: ["No logo", "Logo · top right", "Logo · bottom left"],
        default: k === "tiktok" ? "Logo · top right" : "No logo",
      },
      {
        kind: "select",
        id: "thumb",
        label: k === "tiktok" ? "Cover" : "Thumbnail",
        options:
          k === "tiktok"
            ? ["Frame at 1 second", "Choose a frame in every post"]
            : ["Clip default image", "Choose in every post"],
        default: k === "tiktok" ? "Frame at 1 second" : "Clip default image",
      },
    ],
  };
}

function templateCard(account: SyndicationAccountLike): SyndCard {
  const k = account.platform;
  const tokens = ["{title}", "{short_description}", "{long_description}", "{program}", "{link}"];
  const fields: SyndField[] = [];
  if (k === "youtube" || k === "facebook" || k === "instagram") {
    fields.push({
      kind: "textarea",
      id: "tTitle",
      label: "Title",
      default: "{title}",
      help: "Used where the platform has a title field",
      tokens: tokens.slice(0, 2),
    });
  }
  fields.push({
    kind: "textarea",
    id: "tMsg",
    label: k === "youtube" ? "Description" : k === "twitter" ? "Post text" : "Caption",
    default: k === "twitter" ? "{title}\n{link}" : "{short_description}\n\n{link}",
    help: "Filled in automatically. Editors can change it per post.",
    tokens,
  });
  fields.push({
    kind: "chips",
    id: "tags",
    label: k === "youtube" ? "Tags" : "Hashtags",
    default: k === "youtube" ? ["News"] : ["#News"],
    help: k === "youtube" ? "Added to every upload" : "Added at the end of the text",
    placeholder: "Add…",
  });
  fields.push({
    kind: "toggle",
    id: "link",
    label: "Add a link to the clip page",
    default: k !== "tiktok",
    help: k === "tiktok" ? "TikTok doesn’t make links in captions clickable" : undefined,
  });
  fields.push({
    kind: "text",
    id: "utm",
    label: "Link tracking (UTM)",
    default: "utm_source={network}&utm_medium=social",
    help: "Added to every link",
  });
  return { id: "template", title: "Post template", subtitle: "The default text of every post", fields };
}

function platformCards(account: SyndicationAccountLike): SyndCard[] {
  const k = account.platform;
  if (k === "youtube") {
    return [
      {
        id: "yt",
        title: "YouTube settings",
        subtitle: `Channel: ${account.displayName}`,
        platform: "youtube",
        fields: [
          { kind: "segment", id: "privacy", label: "Visibility", options: ["Public", "Unlisted", "Private"], default: "Private" },
          {
            kind: "select",
            id: "category",
            label: "Category",
            options: ["News & Politics", "Entertainment", "Education", "Sports", "People & Blogs"],
            default: "News & Politics",
          },
          {
            kind: "segment",
            id: "kids",
            label: "Audience",
            options: ["Not made for kids", "Made for kids"],
            default: "Not made for kids",
            help: "Required by YouTube for every video",
          },
          { kind: "select", id: "vlang", label: "Video language", options: LANGS, default: account.language || LANGS[0] },
          {
            kind: "select",
            id: "license",
            label: "License",
            options: ["Standard YouTube License", "Creative Commons – Attribution"],
            default: "Standard YouTube License",
          },
          {
            kind: "select",
            id: "comments",
            label: "Comments",
            options: ["Allow all", "Hold possibly inappropriate for review", "Hold all for review", "Off"],
            default: "Hold possibly inappropriate for review",
          },
          { kind: "toggle", id: "notify", label: "Notify subscribers", default: true },
          { kind: "toggle", id: "embed", label: "Allow embedding", default: true },
          {
            kind: "toggle",
            id: "shorts",
            label: "Vertical clips as Shorts",
            default: true,
            help: "Vertical clips up to 3 minutes go out as Shorts",
          },
        ],
      },
    ];
  }
  if (k === "facebook") {
    return [
      {
        id: "fb",
        title: "Facebook settings",
        subtitle: `Page: ${account.displayName}`,
        platform: "facebook",
        fields: [
          {
            kind: "segment",
            id: "fbAs",
            label: "Post as",
            options: ["Video", "Reel", "Choose by ratio"],
            default: "Choose by ratio",
            help: "Vertical clips go out as Reels, others as videos",
          },
          {
            kind: "select",
            id: "geo",
            label: "Countries",
            options: ["Everyone", "Only selected countries", "Everyone except selected countries"],
            default: "Everyone",
          },
          { kind: "select", id: "age", label: "Age limit", options: ["None", "17+", "18+", "21+"], default: "None" },
          { kind: "toggle", id: "fbComments", label: "Allow comments", default: true },
          { kind: "toggle", id: "crosspost", label: "Let other pages crosspost", default: true },
          { kind: "toggle", id: "fbEmbed", label: "Allow embedding", default: true },
        ],
      },
    ];
  }
  if (k === "instagram") {
    return [
      {
        id: "ig",
        title: "Instagram settings",
        subtitle: `Account: ${account.displayName}`,
        platform: "instagram",
        fields: [
          { kind: "segment", id: "igAs", label: "Post as", options: ["Reel", "Story"], default: "Reel" },
          { kind: "toggle", id: "igFeed", label: "Show the Reel in the profile grid", default: true },
          {
            kind: "chips",
            id: "collab",
            label: "Collaborators",
            default: [],
            help: "Up to 3 accounts, they must accept",
            placeholder: "Add account…",
          },
          { kind: "text", id: "loc", label: "Location tag", default: "", placeholder: "No location" },
          { kind: "toggle", id: "igComments", label: "Allow comments", default: true },
        ],
      },
    ];
  }
  if (k === "twitter") {
    return [
      {
        id: "x",
        title: "X settings",
        subtitle: `Account: ${account.displayName}`,
        platform: "twitter",
        fields: [
          {
            kind: "segment",
            id: "reply",
            label: "Who can reply",
            options: ["Everyone", "Accounts we follow", "Only mentioned", "Verified"],
            default: "Everyone",
          },
          {
            kind: "segment",
            id: "long",
            label: "Text over 280 characters",
            options: ["Cut with …", "Continue in a thread", "Don’t post"],
            default: "Continue in a thread",
          },
          {
            kind: "toggle",
            id: "linkReply",
            label: "Put the link in the first reply",
            default: false,
            help: "Posts with a link in the text often reach fewer people",
          },
          { kind: "toggle", id: "sensitive", label: "Mark media as sensitive", default: false },
        ],
      },
    ];
  }
  // tiktok
  return [
    {
      id: "tt",
      title: "TikTok settings",
      subtitle: `Account: ${account.displayName}`,
      platform: "tiktok",
      fields: [
        {
          kind: "segment",
          id: "ttMode",
          label: "Send as",
          options: ["Post directly", "Draft in the TikTok app"],
          default: "Post directly",
          help: "A draft waits in the TikTok inbox to be finished on the phone",
        },
        {
          kind: "segment",
          id: "ttPriv",
          label: "Who can watch",
          options: ["Everyone", "Followers", "Friends", "Only me"],
          default: "Only me",
        },
        { kind: "toggle", id: "ttComments", label: "Allow comments", default: true },
        { kind: "toggle", id: "duet", label: "Allow Duet", default: true },
        { kind: "toggle", id: "stitch", label: "Allow Stitch", default: true },
        {
          kind: "segment",
          id: "disclose",
          label: "Content disclosure",
          options: ["None", "Your brand", "Branded content"],
          default: "None",
          help: "Required by TikTok for promotional posts",
        },
        {
          kind: "toggle",
          id: "aiLabel",
          label: "AI-generated content label",
          default: false,
          help: "Turn on for posts with AI dubbing",
        },
      ],
    },
  ];
}

function limitsCard(platform: SyndicationPlatform): SyndCard | null {
  const LIM: Partial<Record<SyndicationPlatform, [string, string][]>> = {
    youtube: [
      ["Video", "Up to 256 GB or 12 hours"],
      ["Title", "100 characters"],
      ["Description", "5,000 characters"],
      ["Shorts", "Vertical, up to 3 minutes"],
    ],
    facebook: [
      ["Facebook text", "63,206 characters"],
      ["Facebook Reels", "3 to 90 seconds"],
      ["Best ratio", "4:5 feed, 9:16 Reels"],
    ],
    instagram: [
      ["Instagram caption", "2,200 characters, 30 hashtags"],
      ["Instagram Reels", "3 seconds to 15 minutes"],
      ["Best ratio", "9:16 Reels"],
    ],
    twitter: [
      ["Text", "280 characters"],
      ["Video", "Up to 2 min 20 s, 512 MB"],
    ],
    tiktok: [
      ["Caption", "2,200 characters"],
      ["Video", "3 seconds to 10 minutes"],
      ["Best ratio", "9:16"],
    ],
  };
  const rows = LIM[platform];
  if (!rows) return null;
  return {
    id: "limits",
    title: "Platform limits",
    subtitle: "We check these before posting",
    note: "Limits come from each platform and can change.",
    fields: rows.map(([label, value]) => ({ kind: "info", label, value }) as SyndField),
  };
}

/** Build the two-column card layout for an account's default settings. */
export function buildAccountCards(account: SyndicationAccountLike): { left: SyndCard[]; right: SyndCard[] } {
  const left: SyndCard[] = [...platformCards(account), templateCard(account)];
  const limits = limitsCard(account.platform);
  const right: SyndCard[] = [generalCard(account), mediaCard(account), ...(limits ? [limits] : [])];
  return { left, right };
}

/** Collect default values for all fields in a layout, keyed by field id. */
export function collectDefaults(cards: SyndCard[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const card of cards) {
    for (const f of card.fields) {
      if (f.kind === "info") continue;
      out[f.id] = f.default;
    }
  }
  return out;
}
