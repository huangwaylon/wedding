/**
 * English catalog. Flat keys, dot-namespaced by surface.
 *
 * A pluralised value is an object keyed by CLDR category — the only case where a
 * value is not a string. `test/i18n.test.js` fails on a key nothing references, a
 * referenced key that is missing here, and a key `ja.js` does not also have.
 */
export default {
  'app.name': 'Wedding',

  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.delete': 'Delete',
  'common.close': 'Close',
  'common.restore': 'Restore',
  'common.settings': 'Settings',
  'common.dash': '–',
  'common.saving': 'Saving…',
  'common.loading': 'Loading the board…',
  'common.optional': 'optional',

  'access.viewOnly': 'View only',
  'access.viewOnlyHint':
    'You are viewing this board. Only the couple can change it.',
  'access.rejected': 'This edit link was rejected',
  'access.rejectedHint':
    'It has probably been rotated. Ask for the current link, or paste it in Settings.',
  'access.pasteLabel': 'Paste your edit link',
  'access.pasteHint':
    'Only needed if the link did not carry over — an installed app has its own storage.',
  'access.pasteAction': 'Enable editing',
  'access.pasteBad': 'That does not look like an edit link.',
  'access.pasteOk': 'Editing enabled on this device.',
  'access.revoke': 'Stop editing on this device',
  'access.revokeHint': 'Removes the key from this device only. The link still works.',
  'access.revoked': 'This device is now view-only.',

  'countdown.days': { one: '{count} day to go', other: '{count} days to go' },
  'countdown.today': 'Today is the day',
  'countdown.past': { one: '{count} day ago', other: '{count} days ago' },
  'countdown.unset': 'No wedding date set',

  'overall.title': 'Overall progress',
  'overall.empty': 'Nothing to measure yet',
  'overall.expected': 'On schedule: {percent}%',
  'overall.expectedHint': 'The mark shows where this would sit if everything were on schedule.',
  'overall.pace.ahead': '{percent}% ahead of schedule',
  'overall.pace.behind': {
    one: 'Behind: {count} task is past its date',
    other: 'Behind: {count} tasks are past their date',
  },
  'overall.pace.ontrack': 'On schedule',
  'overall.tasks': { one: '{count} task', other: '{count} tasks' },
  'overall.method': 'Every task counts equally. A task counts as 100% once marked done.',

  'state.done': 'Done',
  'state.overdue': 'Overdue',
  'state.active': 'In progress',
  'state.upcoming': 'Upcoming',
  'state.unscheduled': 'No dates',

  'filter.all': 'All',
  'filter.label': 'Show',
  'view.label': 'View',
  'view.list': 'List',
  'view.timeline': 'Timeline',

  'list.unscheduled': 'No dates set',
  'list.emptyFiltered': 'Nothing matches this filter.',
  'list.showAll': 'Show everything',
  'list.percentLabel': '{percent}% complete',
  'list.markDone': 'Mark done',
  'list.markNotDone': 'Mark not done',
  'list.editTask': 'Edit {title}',
  'list.deleteTask': 'Delete {title}',

  'empty.title': 'The board is empty',
  'empty.viewer': 'The couple has not added anything yet.',
  'empty.editor': 'Add tasks one at a time, or start from a checklist.',
  'empty.needsDate': 'Set the wedding date in Settings first — a checklist is built backwards from it.',
  'empty.setDate': 'Set the wedding date',
  'empty.seedTitle': 'Start from a checklist',
  'empty.seeding': 'Building the checklist…',
  'empty.seeded': { one: 'Added {count} task.', other: 'Added {count} tasks.' },

  'template.classic12': 'Twelve-month plan',
  'template.classic12.about':
    'The long Anglophone countdown: venue and guest list first, then vendors, stationery, and the run-up.',
  'template.japan8': 'Japanese eight-month plan',
  'template.japan8.about':
    '結婚式準備 order: 両家挨拶 and 会場 first, then 打ち合わせ, 招待状, 引き出物 and 席次表.',
  'template.count': { one: '{count} task', other: '{count} tasks' },
  'template.use': 'Use this checklist',

  'form.newTitle': 'New task',
  'form.editTitle': 'Edit task',
  'form.title': 'What has to happen',
  'form.titlePlaceholder': 'Book the venue',
  'form.category': 'Category',
  'form.categoryNone': 'No category',
  'form.allDay': 'All day',
  'form.allDayHint': 'A window of whole days, with no clock time.',
  'form.start': 'Starts',
  'form.end': 'Due by',
  'form.startTime': 'Start time',
  'form.endTime': 'End time',
  'form.owner': 'Who is on it',
  'form.ownerPlaceholder': 'Either of us',
  'form.notes': 'Notes',
  'form.notesPlaceholder': 'Anything worth remembering',
  'form.done': 'Already done',
  'form.deleteThis': 'Delete this task',

  'error.MISSING_TITLE': 'Give the task a name.',
  'error.MISSING_START': 'Set a start date.',
  'error.MISSING_END': 'Set a due date.',
  'error.BAD_START': 'That start date is not a real date.',
  'error.BAD_END': 'That due date is not a real date.',
  'error.END_BEFORE_START': 'The due date is before the start.',

  'confirm.deleteTitle': 'Delete this task?',
  'confirm.deleteBody': '“{title}” goes to the Deleted list, where you can put it back.',

  'detail.state': 'Status',
  'detail.window': 'When',
  'detail.progress': 'Progress',

  'deleted.title': { one: 'Deleted ({count})', other: 'Deleted ({count})' },
  'deleted.restored': 'Task restored.',

  'settings.title': 'Settings',
  'settings.couple': 'The couple',
  'settings.partner1': 'One of you',
  'settings.partner2': 'The other',
  'settings.wedding': 'The wedding',
  'settings.weddingDate': 'Date',
  'settings.weddingTime': 'Time',
  'settings.venue': 'Venue',
  'settings.timezone': 'Time zone',
  'settings.timezoneHint':
    'Every time on this board is read in this zone, so 14:00 means 14:00 at the venue for everyone.',
  'settings.timezoneBad': 'Not a time zone name. Try Asia/Tokyo or America/Los_Angeles.',
  'settings.timezoneMismatch':
    'The spreadsheet itself is set to {zone}. Times typed straight into the sheet may land off.',
  'settings.categories': 'Categories',
  'settings.categoriesHint': 'Comma separated. Used by the category picker.',
  'settings.shared': 'Shared with everyone on this board',
  'settings.device': 'This device only',
  'settings.language': 'Language',
  'settings.accent': 'Colour',
  'settings.access': 'Editing',
  'settings.maintenance': 'Maintenance',
  'settings.compact': 'Purge deleted tasks',
  'settings.compactHint': { one: 'Removes {count} tombstoned row for good.', other: 'Removes {count} tombstoned rows for good.' },
  'settings.compacted': 'Deleted tasks purged.',
  'settings.saved': 'Settings saved.',

  'timeline.title': 'Timeline',
  'timeline.hint': 'Tap a row for details',
  'timeline.zoom': 'Zoom',
  'timeline.zoomIn': 'Zoom in',
  'timeline.zoomOut': 'Zoom out',
  'timeline.today': 'Today',
  'timeline.empty': 'Nothing with dates to draw yet.',
  'timeline.rowLabel': '{title}: {range}, {percent}% complete, {state}',

  'accent.rose': 'Rose',
  'accent.sage': 'Sage',
  'accent.indigo': 'Indigo',
  'accent.plum': 'Plum',
  'accent.gold': 'Gold',

  'category.budget': 'Budget',
  'category.venue': 'Venue',
  'category.guests': 'Guests',
  'category.vendors': 'Vendors',
  'category.attire': 'Attire',
  'category.food': 'Food',
  'category.stationery': 'Stationery',
  'category.photo': 'Photo',
  'category.music': 'Music',
  'category.beauty': 'Beauty',
  'category.gifts': 'Gifts',
  'category.paperwork': 'Paperwork',
  'category.honeymoon': 'Honeymoon',
  'category.other': 'Other',

  'status.stale': 'Showing saved data',
  'status.staleHint': 'The board could not be reached. This is the last copy this device saw.',
  'status.refresh': 'Refresh',

  'toast.saved': 'Saved.',
  'toast.deleted': 'Task deleted.',

  'api.unconfigured': 'This build has no endpoint address',
  'api.unconfiguredHint':
    'VITE_SCRIPT_URL was empty when the site was built. See SETUP.md.',
  'api.unauthorized': 'The edit link was refused',
  'api.not_empty': 'That spreadsheet already has other tabs',
  'api.not_emptyHint':
    'The script refused to add its tabs to a spreadsheet somebody is using. Bind it to an empty one.',
  'api.misconfigured': 'The script is not attached to a spreadsheet',
  'api.misconfiguredHint':
    'It has to be created from the sheet via Extensions › Apps Script. See SETUP.md.',
  'api.busy': 'Somebody else was saving. Try again.',
  'api.not_found': 'That task is no longer in the sheet.',
  'api.transient': 'Could not reach the board.',
}
