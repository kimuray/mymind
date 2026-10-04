import { Mame, MOOD_LABELS, MOODS } from '../components/Mame';
import { PageLayout } from '../components/PageLayout';

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
