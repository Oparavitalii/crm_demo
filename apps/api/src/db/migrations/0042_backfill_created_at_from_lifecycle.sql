-- 2026-06-10 — backfill candidates.created_at з найранішої дати в життєвому
-- циклі рядка (work_start_date / work_end_date / documents_submitted_at /
-- arrived_at). Сьогоднішня масова заливка з xlsx ставить created_at = сьогодні,
-- що ламає всю аналітику по періодах. Тепер created_at = коли ми реально вперше
-- знали кандидата, ± кілька днів.
--
-- birth_date свідомо НЕ беремо — це особистий атрибут, не подія в нашому
-- pipeline. anonymized_at і updated_at — після створення, не до.
--
-- Оновлюємо тільки якщо знайдена дата раніша за поточний created_at — так
-- природньо створені свіжі записи (де лідсорс додав сьогодні) лишаються.

UPDATE candidates
SET created_at = LEAST(
  COALESCE(work_start_date,         created_at),
  COALESCE(work_end_date,           created_at),
  COALESCE(documents_submitted_at,  created_at),
  COALESCE(arrived_at,              created_at)
)
WHERE (
  work_start_date IS NOT NULL
  OR work_end_date IS NOT NULL
  OR documents_submitted_at IS NOT NULL
  OR arrived_at IS NOT NULL
)
AND LEAST(
  COALESCE(work_start_date,         created_at),
  COALESCE(work_end_date,           created_at),
  COALESCE(documents_submitted_at,  created_at),
  COALESCE(arrived_at,              created_at)
) < created_at;
