/**
 * Starter checklists, so a fresh board is not an empty screen.
 *
 * Two, because wedding planning is not one tradition. `classic12` is the
 * twelve-month Anglophone countdown; `japan8` follows the Japanese 結婚式準備
 * schedule, which starts later (about eight months, and 平均10か月前 for the whole
 * process), front-loads 会場 and 両家挨拶, and has items — 引き出物, 席次表, お車代,
 * 婚姻届 — with no counterpart in the other. Neither is a translation of the other
 * and they must not be merged.
 *
 * Sources: The Knot's 12-month countdown; みんなのウェディング「結婚式準備の完全ガイド」;
 * ゼクシィ「結婚式準備のやることリスト」. Task labels here are short imperative
 * summaries, not reproductions of any source's wording.
 *
 * `d` IS THE DUE DATE AS CALENDAR DAYS FROM THE WEDDING DAY, negative for before.
 * Days rather than months so `time.addDays` can do plain calendar arithmetic and no
 * month-length or DST edge case exists, and one date rather than a window because a
 * task here is a deadline: the earlier bound was never anything a person set, checked
 * or looked at, and it made every seeded row carry a date nobody had chosen.
 *
 * Seeding writes the titles in the SEEDING DEVICE'S LANGUAGE, and that is the one
 * place a per-device preference reaches the sheet. It is deliberate: a seeded
 * title is content from that moment on — editable, renameable, and nothing
 * re-renders it — so it is not a localized view of stored data, it *is* the
 * stored data. Everything else written to the sheet stays language-independent.
 */

import { addDays } from './time.js'

/**
 * The category vocabulary both templates draw from, and the default for a fresh
 * board. Stored in the sheet verbatim so a person editing the spreadsheet by hand
 * reads words rather than codes; the UI translates a KNOWN value through
 * `category.<lowercased>` in the catalogs and falls back to the raw string, so a
 * category somebody invents shows up exactly as they typed it.
 */
export const CATEGORIES = [
  'Budget',
  'Venue',
  'Guests',
  'Vendors',
  'Attire',
  'Food',
  'Stationery',
  'Photo',
  'Music',
  'Beauty',
  'Gifts',
  'Paperwork',
  'Honeymoon',
  'Other',
]

/**
 * A template is an id and its tasks. There is no length or description field: the id names the
 * shape ("classic12", "japan8"), the count is `tasks.length`, and the UI offers each list by
 * name and size alone — anything longer would be copy nobody reads twice.
 *
 * @type {{id: string, tasks: Array}[]}
 */
export const TEMPLATES = [
  {
    id: 'classic12',
    tasks: [
      { c: 'Budget', d: -335, en: 'Agree the budget and who is contributing', ja: '予算と、誰がいくら出すかを決める' },
      { c: 'Guests', d: -335, en: 'Draft the guest count and your priorities', ja: 'おおよそのゲスト人数と優先順位を決める' },
      { c: 'Vendors', d: -330, en: 'Decide whether to hire a planner', ja: 'ウェディングプランナーに依頼するか決める' },
      { c: 'Venue', d: -320, en: 'Tour venues and compare quotes', ja: '会場を下見して見積もりを比較する' },
      { c: 'Venue', d: -310, en: 'Lock the date and book the venue', ja: '日取りを確定し会場を予約する' },
      { c: 'Guests', d: -300, en: 'Choose the wedding party', ja: '介添人・受付などの役割を決める' },
      { c: 'Guests', d: -290, en: 'Finalise the guest list and collect addresses', ja: 'ゲストリストを確定し住所を集める' },
      { c: 'Attire', d: -250, en: 'Start shopping for wedding attire', ja: '衣裳探しを始める' },
      { c: 'Guests', d: -260, en: 'Reserve hotel room blocks', ja: 'ゲスト用の宿泊を確保する' },
      { c: 'Guests', d: -250, en: 'Arrange guest transport and shuttles', ja: 'ゲストの送迎・交通手段を手配する' },
      { c: 'Photo', d: -250, en: 'Book the photographer and videographer', ja: '写真・ビデオ撮影を依頼する' },
      { c: 'Music', d: -245, en: 'Book the band or DJ', ja: '演奏・DJを手配する' },
      { c: 'Vendors', d: -240, en: 'Reserve rentals: tables, linens, tent', ja: 'テーブル・リネン・テントなどをレンタル予約する' },
      { c: 'Stationery', d: -240, en: 'Design and order save-the-dates', ja: '日程案内カードをデザインして発注する' },
      { c: 'Photo', d: -230, en: 'Book the engagement shoot', ja: '前撮りを予約する' },
      { c: 'Stationery', d: -220, en: 'Build the wedding website', ja: '結婚式のウェブサイトを作る' },
      { c: 'Gifts', d: -210, en: 'Set up the gift registry', ja: 'ギフトレジストリを設定する' },
      { c: 'Stationery', d: -225, en: 'Mail the save-the-dates', ja: '日程案内カードを発送する' },
      { c: 'Honeymoon', d: -180, en: 'Research the honeymoon', ja: '新婚旅行の行き先を調べる' },
      { c: 'Attire', d: -180, en: 'Choose the wedding party attire', ja: '参列者の衣裳を決める' },
      { c: 'Food', d: -175, en: 'Book the rehearsal dinner', ja: '前夜の会食を手配する' },
      { c: 'Vendors', d: -170, en: 'Confirm the remaining vendors', ja: '残りの業者をすべて確定する' },
      { c: 'Attire', d: -150, en: 'Shop for the wedding bands', ja: '結婚指輪を選ぶ' },
      { c: 'Beauty', d: -145, en: 'Book hair and makeup', ja: 'ヘアメイクを予約する' },
      { c: 'Paperwork', d: -140, en: 'Renew passports if travelling abroad', ja: '海外へ行くならパスポートを更新する' },
      { c: 'Stationery', d: -145, en: 'Finalise the invitation design', ja: '招待状のデザインを確定する' },
      { c: 'Stationery', d: -130, en: 'Order the invitations', ja: '招待状を発注する' },
      { c: 'Food', d: -120, en: 'Plan the menu and book a tasting', ja: '料理を決めて試食を予約する' },
      { c: 'Paperwork', d: -120, en: 'Book the officiant', ja: '司式者を依頼する' },
      { c: 'Honeymoon', d: -115, en: 'Book the honeymoon flights and lodging', ja: '新婚旅行の航空券と宿を予約する' },
      { c: 'Music', d: -95, en: 'Choose the ceremony and first-dance music', ja: '挙式とファーストダンスの曲を決める' },
      { c: 'Gifts', d: -90, en: 'Order signage, vow books and favours', ja: 'サイン・誓いの言葉帳・プチギフトを発注する' },
      { c: 'Stationery', d: -85, en: 'Print the ceremony programmes', ja: '式次第を印刷する' },
      { c: 'Gifts', d: -70, en: 'Buy gifts for the wedding party and family', ja: '参列者と家族への贈り物を用意する' },
      { c: 'Beauty', d: -65, en: 'Hair and makeup trial', ja: 'ヘアメイクリハーサルを行う' },
      { c: 'Stationery', d: -75, en: 'Mail the invitations', ja: '招待状を発送する' },
      { c: 'Other', d: -25, en: 'Write the vows', ja: '誓いの言葉を書く' },
      { c: 'Gifts', d: -30, en: 'Pack the favours and welcome bags', ja: 'プチギフトとウェルカムバッグを詰める' },
      { c: 'Attire', d: -20, en: 'Final attire alterations', ja: '衣裳の最終お直しを済ませる' },
      { c: 'Paperwork', d: -20, en: 'Apply for the marriage licence', ja: '婚姻の手続きを申請する' },
      { c: 'Guests', d: -12, en: 'Finalise the seating chart', ja: '席次を確定する' },
      { c: 'Guests', d: -14, en: 'Chase the outstanding RSVPs', ja: '未返信のゲストに出欠を確認する' },
      { c: 'Vendors', d: -12, en: 'Final meeting with the planner', ja: 'プランナーとの最終打ち合わせ' },
      { c: 'Photo', d: -10, en: 'Send the shot list to the photographer', ja: '撮影指示書をカメラマンに送る' },
      { c: 'Food', d: -6, en: 'Give the final head count to the caterer', ja: '最終人数を料理担当に伝える' },
      { c: 'Vendors', d: -5, en: 'Reconfirm timings with every vendor', ja: '全業者と当日の時間を再確認する' },
      { c: 'Attire', d: -2, en: 'Press the outfits and pack the day-of bag', ja: '衣裳にアイロンをかけ当日の荷物をまとめる' },
      { c: 'Budget', d: -1, en: 'Write the vendor cheques and tip envelopes', ja: '支払いとお礼の封筒を用意する' },
      { c: 'Paperwork', d: -1, en: 'Hand the licence to the officiant', ja: '書類を司式者に預ける' },
      { c: 'Food', d: -1, en: 'Ceremony rehearsal and rehearsal dinner', ja: 'リハーサルと前夜の会食' },
      { c: 'Other', d: 0, en: 'Wedding day', ja: '結婚式当日' },
      { c: 'Gifts', d: 45, en: 'Send thank-you notes and vendor reviews', ja: 'お礼状を出し、業者のレビューを書く' },
    ],
  },
  {
    id: 'japan8',
    tasks: [
      { c: 'Other', d: -210, en: 'Agree on the style of wedding you want', ja: 'ふたりで結婚式のイメージを固める' },
      { c: 'Budget', d: -215, en: 'Set the budget and its ceiling', ja: '予算と上限額を決める' },
      { c: 'Guests', d: -195, en: 'Greet both families and hold the introductions', ja: '両家へ挨拶し、顔合わせを済ませる' },
      { c: 'Guests', d: -200, en: 'Draft the guest list by group', ja: '招待ゲストを親族・職場・友人に分けてリストアップする' },
      { c: 'Venue', d: -190, en: 'Shortlist venues and attend bridal fairs', ja: '会場をリストアップし、ブライダルフェアに参加する' },
      { c: 'Venue', d: -180, en: 'Decide the date and book the venue', ja: '日取りと会場を決定して予約する' },
      { c: 'Guests', d: -170, en: 'Sound out guests about attending', ja: 'ゲストへ出席を打診する' },
      { c: 'Budget', d: -140, en: 'Decide what to spend the budget on', ja: 'お金のかけどころを検討する' },
      { c: 'Attire', d: -100, en: 'Start trying on outfits', ja: '衣裳の試着をスタートする' },
      { c: 'Attire', d: -105, en: 'Choose and order the wedding rings', ja: '結婚指輪を検討して購入する' },
      { c: 'Photo', d: -120, en: 'Decide on a pre-wedding shoot', ja: '前撮りを検討する' },
      { c: 'Venue', d: -105, en: 'First planning meeting at the venue', ja: '式場との初回打ち合わせで、テーマと流れを決める' },
      { c: 'Stationery', d: -95, en: 'Choose the invitation design and order it', ja: '招待状のデザインを決め、作成を始める' },
      { c: 'Food', d: -85, en: 'Taste and choose the menu and the cake', ja: '料理・ドリンクとウェディングケーキを決める' },
      { c: 'Guests', d: -90, en: 'Ask guests to speak, toast or perform', ja: '主賓挨拶・乾杯・余興を依頼する' },
      { c: 'Other', d: -80, en: 'Decide on an after-party and arrange it', ja: '二次会を開催するか決め、会場と幹事を手配する' },
      { c: 'Beauty', d: -75, en: 'Book bridal beauty treatments', ja: 'ブライダルエステを検討して申し込む' },
      { c: 'Attire', d: -70, en: 'Confirm the dress and the tuxedo', ja: 'ドレスとタキシードを正式に決定する' },
      { c: 'Photo', d: -45, en: 'Take the pre-wedding photos', ja: '前撮りを実施する' },
      { c: 'Stationery', d: -50, en: 'Mail the invitations', ja: '招待状を発送する' },
      { c: 'Other', d: -40, en: 'Settle the flowers and the bouquet', ja: '会場装花とブーケのイメージを固める' },
      { c: 'Gifts', d: -40, en: 'Choose the guest gifts', ja: '引き出物・引き菓子・プチギフトを選ぶ' },
      { c: 'Other', d: -35, en: 'Prepare the profile video', ja: 'プロフィールムービーを準備する' },
      { c: 'Photo', d: -40, en: 'Confirm the photographer and the shot list', ja: '写真・ビデオ撮影を依頼し、撮影指示書を作る' },
      { c: 'Guests', d: -35, en: 'Arrange travel and lodging for distant guests', ja: '遠方ゲストの宿泊と交通手段を手配する' },
      { c: 'Guests', d: -25, en: 'Confirm the RSVPs and draft the seating', ja: '出欠を確認し、席次の検討を始める' },
      { c: 'Vendors', d: -30, en: 'Brief the MC on the running order', ja: '司会者と当日の進行を打ち合わせる' },
      { c: 'Guests', d: -14, en: 'Finalise the seating chart', ja: '席次表を完成させる' },
      { c: 'Music', d: -14, en: 'Confirm the music, running order and paper items', ja: 'BGM・進行・ペーパーアイテムを決定する' },
      { c: 'Beauty', d: -14, en: 'Hair and makeup rehearsal', ja: 'ヘアメイクリハーサルを行う' },
      { c: 'Budget', d: -7, en: 'Prepare thank-you money in new notes', ja: 'お礼・お車代を新札とポチ袋で用意する' },
      { c: 'Other', d: -5, en: "Finish the bride's letter and the groom's speech", ja: '花嫁の手紙と新郎謝辞を書き上げる' },
      { c: 'Attire', d: -7, en: 'Final fitting, and a haircut', ja: '衣裳の最終フィッティングとヘアカット' },
      { c: 'Venue', d: -10, en: 'Final venue meeting and payment', ja: '式場との最終打ち合わせと費用の支払い' },
      { c: 'Gifts', d: -5, en: 'Prepare the gifts for both sets of parents', ja: '両親への記念品を準備する' },
      { c: 'Vendors', d: -2, en: 'Deliver self-arranged items to the venue', ja: '自己手配アイテムを式場へ搬入する' },
      { c: 'Other', d: 0, en: 'Wedding day', ja: '結婚式当日' },
      { c: 'Paperwork', d: 30, en: 'File the marriage registration', ja: '婚姻届を提出する' },
    ],
  },
]

export const TEMPLATE_IDS = TEMPLATES.map((template) => template.id)

export function findTemplate(id) {
  return TEMPLATES.find((template) => template.id === id) ?? null
}

/**
 * A template plus a wedding date -> task drafts ready for `createMany`.
 *
 * @param {object} template
 * @param {string} weddingDay 'YYYY-MM-DD'
 * @param {object} opts
 * @param {string} opts.locale which title to write
 * @param {() => string} opts.newId injected so tests are deterministic
 */
export function materialize(template, weddingDay, { locale = 'en', newId }) {
  if (!template || !/^\d{4}-\d{2}-\d{2}$/.test(String(weddingDay ?? ''))) return []

  return template.tasks.map((item) => ({
    id: newId(),
    title: item[locale] ?? item.en,
    category: item.c,
    due: addDays(weddingDay, item.d),
    doneAt: '',
    deletedAt: '',
  }))
}
