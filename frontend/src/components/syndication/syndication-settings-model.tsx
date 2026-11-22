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
    permissions: ["Upload videos to the channel"],
  },
  facebook: {
    label: "Facebook",
    shortLabel: "Facebook",
    glyph: "f",
    iconBg: "#1877f2",
    connectDescription: "Pages you manage",
    permissions: ["Post videos to your pages", "Read page names and pictures"],
  },
  instagram: {
    label: "Instagram",
    shortLabel: "Instagram",
    glyph: "IG",
    iconBg: "#c1358a",
    connectDescription: "Business or creator accounts linked to a page",
    permissions: ["Post Reels and feed videos to linked Instagram accounts", "Read account details"],
  },
  twitter: {
    label: "X (Twitter)",
    shortLabel: "X",
    glyph: "X",
    iconBg: "#14171a",
    connectDescription: "One X account per connection",
    permissions: ["Post for this account", "Upload videos", "Read profile details"],
  },
  tiktok: {
    label: "TikTok",
    shortLabel: "TikTok",
    glyph: "TT",
    iconBg: "#111111",
    connectDescription: "Business or creator accounts",
    permissions: ["Post videos directly to the account", "Read profile details"],
  },
};

/**
 * A single configurable field inside a settings card. The field `id` is the key stored by the
 * backend. For `select` / `segment`, `values[i]` is the stored value for `options[i]`; without
 * `values` the option label itself is stored.
 */
export type SyndField =
  | { kind: "info"; label: string; value: string; help?: string }
  | {
      kind: "select";
      id: string;
      label: string;
      options: string[];
      values?: (string | boolean)[];
      default: string;
      help?: string;
      disabled?: boolean;
    }
  | {
      kind: "segment";
      id: string;
      label: string;
      options: string[];
      values?: (string | boolean)[];
      default: string;
      help?: string;
    }
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
};

const TEMPLATE_TOKENS = ["{title}", "{short_description}", "{long_description}"];
const TOKEN_HELP = "{title} and {short_description} are filled from the clip.";

function textTemplateField(id: string, label: string, defaultValue: string, help?: string): SyndField {
  return {
    kind: "textarea",
    id,
    label,
    default: defaultValue,
    help: help ? `${help} ${TOKEN_HELP}` : TOKEN_HELP,
    tokens: TEMPLATE_TOKENS,
  };
}

function hashtagsField(): SyndField {
  return {
    kind: "chips",
    id: "hashtags",
    label: "Hashtags",
    default: [],
    help: "Added at the end of the text",
    placeholder: "Add…",
  };
}

function youtubeCards(account: SyndicationAccountLike): SyndCard[] {
  return [
    {
      id: "yt",
      title: "YouTube settings",
      subtitle: `Channel: ${account.displayName}`,
      platform: "youtube",
      fields: [
        {
          kind: "segment",
          id: "privacyStatus",
          label: "Visibility",
          options: ["Public", "Unlisted", "Private"],
          values: ["public", "unlisted", "private"],
          default: "Private",
        },
        {
          kind: "select",
          id: "categoryId",
          label: "Category",
          options: ["News & Politics", "Entertainment", "Education", "Sports", "People & Blogs"],
          values: ["25", "24", "27", "17", "22"],
          default: "News & Politics",
        },
        {
          kind: "segment",
          id: "selfDeclaredMadeForKids",
          label: "Audience",
          options: ["Not made for kids", "Made for kids"],
          values: [false, true],
          default: "Not made for kids",
          help: "Required by YouTube for every video",
        },
        {
          kind: "select",
          id: "defaultLanguage",
          label: "Video language",
          options: ["Arabic", "English", "Hebrew", "French", "Spanish"],
          values: ["ar", "en", "he", "fr", "es"],
          default: "English",
        },
        {
          kind: "select",
          id: "license",
          label: "License",
          options: ["Standard YouTube License", "Creative Commons – Attribution"],
          values: ["youtube", "creativeCommon"],
          default: "Standard YouTube License",
        },
        { kind: "toggle", id: "notifySubscribers", label: "Notify subscribers", default: true },
        { kind: "toggle", id: "embeddable", label: "Allow embedding", default: true },
        {
          kind: "toggle",
          id: "publicStatsViewable",
          label: "Public statistics",
          default: true,
          help: "Extended statistics on the watch page",
        },
      ],
    },
    {
      id: "template",
      title: "Post template",
      subtitle: "Default title, description and tags sent with every upload",
      fields: [
        textTemplateField("titleTemplate", "Title", "{title}"),
        textTemplateField("descriptionTemplate", "Description", "{short_description}"),
        {
          kind: "chips",
          id: "tags",
          label: "Tags",
          default: ["News"],
          help: "Added to every upload, together with the clip tags",
          placeholder: "Add…",
        },
      ],
    },
  ];
}

function facebookCards(account: SyndicationAccountLike): SyndCard[] {
  return [
    {
      id: "template",
      title: "Post template",
      subtitle: `Page: ${account.displayName}`,
      platform: "facebook",
      fields: [
        textTemplateField("titleTemplate", "Title", "{title}"),
        textTemplateField("descriptionTemplate", "Description", "{short_description}"),
        hashtagsField(),
      ],
    },
  ];
}

function instagramCards(account: SyndicationAccountLike): SyndCard[] {
  return [
    {
      id: "ig",
      title: "Instagram settings",
      subtitle: `Account: ${account.displayName}`,
      platform: "instagram",
      fields: [
        {
          kind: "segment",
          id: "mediaType",
          label: "Post as",
          options: ["Reel", "Feed video"],
          values: ["reels", "feed"],
          default: "Reel",
        },
        {
          kind: "toggle",
          id: "shareToFeed",
          label: "Show the Reel in the profile grid",
          default: true,
          help: "Only applies to Reels",
        },
      ],
    },
    {
      id: "template",
      title: "Post template",
      subtitle: "Default caption of every post",
      fields: [textTemplateField("captionTemplate", "Caption", "{title}\n\n{short_description}"), hashtagsField()],
    },
  ];
}

function twitterCards(account: SyndicationAccountLike): SyndCard[] {
  return [
    {
      id: "x",
      title: "X settings",
      subtitle: `Account: ${account.displayName}`,
      platform: "twitter",
      fields: [
        {
          kind: "segment",
          id: "replySettings",
          label: "Who can reply",
          options: ["Everyone", "Accounts you follow", "Only mentioned accounts"],
          values: ["everyone", "following", "mentionedUsers"],
          default: "Everyone",
        },
      ],
    },
    {
      id: "template",
      title: "Post template",
      subtitle: "Default text of every post",
      fields: [
        textTemplateField("textTemplate", "Post text", "{title}", "Cut to 280 characters."),
        hashtagsField(),
      ],
    },
  ];
}

function tiktokCards(account: SyndicationAccountLike): SyndCard[] {
  return [
    {
      id: "tt",
      title: "TikTok settings",
      subtitle: `Account: ${account.displayName}`,
      platform: "tiktok",
      fields: [
        {
          kind: "segment",
          id: "privacyLevel",
          label: "Who can watch",
          options: ["Everyone", "Followers", "Friends", "Only me"],
          values: ["PUBLIC_TO_EVERYONE", "FOLLOWER_OF_CREATOR", "MUTUAL_FOLLOW_FRIENDS", "SELF_ONLY"],
          default: "Only me",
          help: "Unaudited TikTok apps can only post as Only me",
        },
        { kind: "toggle", id: "allowComments", label: "Allow comments", default: true },
        { kind: "toggle", id: "allowDuet", label: "Allow Duet", default: true },
        { kind: "toggle", id: "allowStitch", label: "Allow Stitch", default: true },
        {
          kind: "segment",
          id: "disclosure",
          label: "Content disclosure",
          options: ["None", "Your brand", "Branded content"],
          values: ["none", "your_brand", "branded_content"],
          default: "None",
          help: "Required by TikTok for promotional posts",
        },
        {
          kind: "toggle",
          id: "aiGenerated",
          label: "AI-generated content label",
          default: false,
          help: "Turn on for posts with AI dubbing",
        },
      ],
    },
    {
      id: "template",
      title: "Post template",
      subtitle: "Default caption of every post",
      fields: [textTemplateField("captionTemplate", "Caption", "{title}\n\n{short_description}"), hashtagsField()],
    },
  ];
}

function limitsCard(platform: SyndicationPlatform): SyndCard {
  const LIM: Record<SyndicationPlatform, [string, string][]> = {
    youtube: [
      ["Video", "Up to 256 GB or 12 hours"],
      ["Title", "100 characters"],
      ["Description", "5,000 characters"],
    ],
    facebook: [
      ["Title", "255 characters"],
      ["Description", "5,000 characters"],
    ],
    instagram: [
      ["Caption", "2,200 characters, 30 hashtags"],
      ["Reels", "3 seconds to 15 minutes"],
    ],
    twitter: [
      ["Text", "280 characters"],
      ["Video", "Up to 2 min 20 s, 512 MB"],
    ],
    tiktok: [
      ["Caption", "2,200 characters"],
      ["Video", "3 seconds to 10 minutes"],
    ],
  };
  return {
    id: "limits",
    title: "Platform limits",
    subtitle: "Longer text is cut before posting",
    note: "Limits come from each platform and can change.",
    fields: LIM[platform].map(([label, value]) => ({ kind: "info", label, value }) as SyndField),
  };
}

/** Build the two-column card layout for an account's default settings. */
export function buildAccountCards(account: SyndicationAccountLike): { left: SyndCard[]; right: SyndCard[] } {
  const builders: Record<SyndicationPlatform, (a: SyndicationAccountLike) => SyndCard[]> = {
    youtube: youtubeCards,
    facebook: facebookCards,
    instagram: instagramCards,
    twitter: twitterCards,
    tiktok: tiktokCards,
  };
  return { left: builders[account.platform](account), right: [limitsCard(account.platform)] };
}

function editableFields(cards: SyndCard[]): Exclude<SyndField, { kind: "info" }>[] {
  return cards.flatMap((card) => card.fields).filter((f): f is Exclude<SyndField, { kind: "info" }> => f.kind !== "info");
}

/** Collect default values for all fields in a layout, keyed by field id. */
export function collectDefaults(cards: SyndCard[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of editableFields(cards)) out[f.id] = f.default;
  return out;
}

/** Form draft (option labels) → settings payload stored by the backend. */
export function draftToSettings(cards: SyndCard[], draft: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of editableFields(cards)) {
    const value = draft[f.id] ?? f.default;
    if ((f.kind === "select" || f.kind === "segment") && f.values) {
      const index = f.options.indexOf(String(value));
      out[f.id] = f.values[index >= 0 ? index : f.options.indexOf(f.default)];
    } else {
      out[f.id] = value;
    }
  }
  return out;
}

/** Settings payload from the backend → form draft (option labels). */
export function settingsToDraft(cards: SyndCard[], settings: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of editableFields(cards)) {
    const stored = settings[f.id];
    if ((f.kind === "select" || f.kind === "segment") && f.values) {
      const index = f.values.indexOf(stored as string | boolean);
      out[f.id] = index >= 0 ? f.options[index] : f.default;
    } else if (stored === undefined) {
      out[f.id] = f.default;
    } else {
      out[f.id] = stored;
    }
  }
  return out;
}
