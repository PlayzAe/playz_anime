import type { Chapter, Episode, MediaSnapshot } from '../../shared/types';
import { GetAppDialog } from './GetApp';

/*
 * Downloads live in the Windows app: a browser can't write MP4s and CBZs into
 * folders or play them back offline. These keep the desktop dialogs' names and
 * props, so the Watch, Series and Manga pages stay identical, and explain where
 * downloading lives instead.
 */

interface EpisodeDialogProps {
  open: boolean;
  onClose: () => void;
  media: MediaSnapshot | null;
  episodes: Episode[];
  initial?: { from: number; to: number };
  defaultAudio?: 'sub' | 'dub';
}

export function EpisodeDownloadDialog({ open, onClose, media }: EpisodeDialogProps) {
  return <GetAppDialog open={open} onClose={onClose} what={media ? `episodes of ${media.title}` : 'episodes'} />;
}

interface ChapterDialogProps {
  open: boolean;
  onClose: () => void;
  media: MediaSnapshot | null;
  chapters: Chapter[];
  unread?: Chapter[];
}

export function ChapterDownloadDialog({ open, onClose, media }: ChapterDialogProps) {
  return <GetAppDialog open={open} onClose={onClose} what={media ? `chapters of ${media.title}` : 'chapters'} />;
}
