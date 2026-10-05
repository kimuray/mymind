import { useState } from 'react';
import { Button } from '../components/Button';
import { Mame, MOOD_LABELS, MOODS } from '../components/Mame';
import { PageLayout } from '../components/PageLayout';

const SIZES = [28, 44, 76, 96] as const;

/** マメの7つの表情を並べた確認用のページ（#37 の完了条件） */
export function MameGalleryPage() {
  // 表情を順に変えて、変わるときの動き（DESIGN.md 4.1）を確かめる
  const [index, setIndex] = useState(0);
  const mood = MOODS[index % MOODS.length] ?? 'normal';
  return (
    <PageLayout>
      <section className="page">
        <h1 className="text-display">マメの表情</h1>
        <div className="mame-gallery-demo">
          <Mame mood={mood} size={96} />
          <Button onClick={() => setIndex((i) => i + 1)}>
            {`表情を変える（今：${MOOD_LABELS[mood]}）`}
          </Button>
        </div>
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
