import { NavLink } from 'react-router';
import type { GradingBlock } from '../../api/contract';
import { RankBar } from '../../design/RankBar';
import s from './Grading.module.css';

/** Карточки индустриальных блоков: полоса прогресса, справа — «N из M оценено». */
export function BlocksList({ blocks }: { blocks: GradingBlock[] }) {
  return (
    <div className={s.blockGrid}>
      {blocks.map(b => (
        <NavLink key={b.key} to={`/grading/${b.key}`} className={s.blockCard}>
          <div className={s.blockTitle}>{b.label}</div>
          <RankBar
            label={`${b.evaluated_count} из ${b.position_count} оценено`}
            pct={b.position_count > 0 ? Math.round((b.evaluated_count / b.position_count) * 100) : 0}
          />
        </NavLink>
      ))}
      {!blocks.length && <p className={s.empty}>Блоки не настроены.</p>}
    </div>
  );
}
