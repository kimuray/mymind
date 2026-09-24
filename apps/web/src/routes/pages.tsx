import { Mame, MOOD_LABELS, MOODS } from '../components/Mame';
import { PageLayout } from '../components/PageLayout';

// まだ中身を作っていない画面。それぞれの issue で作る。ここでは見出しだけを置く

function Page({ title, note }: { title: string; note?: string }) {
  return (
    <PageLayout>
      <section className="page">
        <h1 className="text-display">{title}</h1>
        {note !== undefined && <p className="empty-note">{note}</p>}
      </section>
    </PageLayout>
  );
}

export const MorningPage = () => <Page title="朝の計画" />;
export function ReflectionPage({ day }: { day: string | undefined }) {
  return <Page title="振り返り" {...(day === undefined ? {} : { note: day })} />;
}
export const TimelinePage = () => <Page title="タイムライン" />;
export function CalendarPage({ ym, day }: { ym: string; day: string | undefined }) {
  return <Page title="カレンダー" note={day ?? ym} />;
}

const SIZES = [28, 44, 76, 96] as const;

/** マメの7つの表情を並べた確認用のページ（#37 の完了条件） */
export function MameGalleryPage() {
  return (
    <PageLayout>
      <section className="page">
        <h1 className="text-display">マメの表情</h1>
        <table className="mame-gallery">
          <thead>
            <tr>
              <th scope="col">mood</th>
              {SIZES.map((size) => (
                <th key={size} scope="col">
                  {size}px
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MOODS.map((mood) => (
              <tr key={mood}>
                <th scope="row">
                  <code>{mood}</code> {MOOD_LABELS[mood]}
                </th>
                {SIZES.map((size) => (
                  <td key={size}>
                    <Mame mood={mood} size={size} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </PageLayout>
  );
}
