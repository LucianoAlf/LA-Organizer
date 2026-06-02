-- Seed DEMO financeiro — colaborador Luciano (0576f4b6-183d-4cf1-980e-5c8d5da0177f)
-- Objetivo: cadastro cheio e realista pra gravação de vídeo. MANTÉM carteiras e cartões;
-- zera transações/contas-fixas/metas/orçamentos e recria. Saldos vêm dos triggers.
-- Datas: ref. junho/2026 (mês corrente) + abril/maio pra alimentar o gráfico de 6 meses.

-- ===================== 1) CLEAN SLATE (mantém pf_accounts + pf_cards) =====================
DELETE FROM pf_card_payments      WHERE collaborator_id='0576f4b6-183d-4cf1-980e-5c8d5da0177f';
DELETE FROM pf_transfers          WHERE collaborator_id='0576f4b6-183d-4cf1-980e-5c8d5da0177f';
DELETE FROM pf_goal_contributions WHERE collaborator_id='0576f4b6-183d-4cf1-980e-5c8d5da0177f';
DELETE FROM pf_transactions       WHERE collaborator_id='0576f4b6-183d-4cf1-980e-5c8d5da0177f';
DELETE FROM pf_bills              WHERE collaborator_id='0576f4b6-183d-4cf1-980e-5c8d5da0177f';
DELETE FROM pf_goals              WHERE collaborator_id='0576f4b6-183d-4cf1-980e-5c8d5da0177f';
DELETE FROM pf_budgets            WHERE collaborator_id='0576f4b6-183d-4cf1-980e-5c8d5da0177f';
UPDATE pf_accounts SET balance=0  WHERE collaborator_id='0576f4b6-183d-4cf1-980e-5c8d5da0177f';

-- ===================== 2) SALDOS DE ABERTURA (is_adjustment → fora dos relatórios) =====================
-- Itau=e74ef49a / Nubank=4d00cc3b / C6=47a737e7 / Santander=b9e244ae / Dinheiro=a87122dd
INSERT INTO pf_transactions (collaborator_id, account_id, type, category, amount, description, transaction_date, via, is_adjustment) VALUES
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','e74ef49a-8fd2-4cae-bbec-dba78b76e20c','income','outras_receitas',1500,'Saldo inicial','2026-04-01','pwa',true),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','4d00cc3b-c38e-438d-9ff4-718cf8cb130e','income','outras_receitas',1800,'Saldo inicial','2026-04-01','pwa',true),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','47a737e7-5c89-4cfe-b08e-887f65bd0b97','income','outras_receitas',1200,'Saldo inicial','2026-04-01','pwa',true),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','b9e244ae-da1f-4b82-a6fd-e10dd0d386cf','income','outras_receitas',5000,'Saldo inicial','2026-04-01','pwa',true),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','a87122dd-7973-4329-97ee-929fde58c5df','income','outras_receitas',350,'Saldo inicial','2026-04-01','pwa',true);

-- ===================== 3) TRANSAÇÕES EM CAIXA (conta) — receitas e despesas =====================
INSERT INTO pf_transactions (collaborator_id, account_id, type, category, amount, description, transaction_date, via) VALUES
-- Receitas
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','e74ef49a-8fd2-4cae-bbec-dba78b76e20c','income','salario',6500,'Salário','2026-04-05','pwa'),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','e74ef49a-8fd2-4cae-bbec-dba78b76e20c','income','salario',6500,'Salário','2026-05-05','pwa'),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','4d00cc3b-c38e-438d-9ff4-718cf8cb130e','income','freelance',1500,'Freela design','2026-05-20','pwa'),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','b9e244ae-da1f-4b82-a6fd-e10dd0d386cf','income','investimentos',85,'Rendimento CDB','2026-05-10','pwa'),
-- Abril (despesas)
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','e74ef49a-8fd2-4cae-bbec-dba78b76e20c','expense','mercado',380,'Supermercado','2026-04-06','pwa'),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','4d00cc3b-c38e-438d-9ff4-718cf8cb130e','expense','alimentacao',52,'iFood','2026-04-08','pwa'),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','a87122dd-7973-4329-97ee-929fde58c5df','expense','transporte',24,'Uber','2026-04-10','pwa'),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','e74ef49a-8fd2-4cae-bbec-dba78b76e20c','expense','moradia',1800,'Aluguel','2026-04-15','pwa'),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','47a737e7-5c89-4cfe-b08e-887f65bd0b97','expense','combustivel',200,'Posto','2026-04-12','pwa'),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','e74ef49a-8fd2-4cae-bbec-dba78b76e20c','expense','farmacia',75,'Farmácia','2026-04-20','pwa'),
-- Maio (despesas)
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','e74ef49a-8fd2-4cae-bbec-dba78b76e20c','expense','mercado',410,'Supermercado','2026-05-06','pwa'),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','4d00cc3b-c38e-438d-9ff4-718cf8cb130e','expense','alimentacao',63,'iFood','2026-05-09','pwa'),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','a87122dd-7973-4329-97ee-929fde58c5df','expense','transporte',31,'Uber','2026-05-11','pwa'),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','e74ef49a-8fd2-4cae-bbec-dba78b76e20c','expense','moradia',1800,'Aluguel','2026-05-15','pwa'),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','47a737e7-5c89-4cfe-b08e-887f65bd0b97','expense','combustivel',190,'Posto','2026-05-14','pwa'),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','4d00cc3b-c38e-438d-9ff4-718cf8cb130e','expense','restaurante',120,'Jantar','2026-05-18','pwa'),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','e74ef49a-8fd2-4cae-bbec-dba78b76e20c','expense','lazer',60,'Cinema','2026-05-22','pwa'),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','e74ef49a-8fd2-4cae-bbec-dba78b76e20c','expense','assinaturas',55,'Netflix','2026-05-02','pwa'),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','e74ef49a-8fd2-4cae-bbec-dba78b76e20c','expense','assinaturas',22,'Spotify','2026-05-02','pwa'),
-- Junho (mês corrente)
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','e74ef49a-8fd2-4cae-bbec-dba78b76e20c','expense','mercado',295,'Supermercado','2026-06-01','pwa'),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','4d00cc3b-c38e-438d-9ff4-718cf8cb130e','expense','alimentacao',44,'iFood','2026-06-01','pwa'),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','a87122dd-7973-4329-97ee-929fde58c5df','expense','transporte',19,'Uber','2026-06-02','pwa'),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','47a737e7-5c89-4cfe-b08e-887f65bd0b97','expense','combustivel',180,'Posto','2026-06-01','pwa'),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','e74ef49a-8fd2-4cae-bbec-dba78b76e20c','expense','farmacia',38,'Farmácia','2026-06-02','pwa'),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','4d00cc3b-c38e-438d-9ff4-718cf8cb130e','expense','restaurante',88,'Almoço','2026-06-01','pwa');

-- ===================== 4) TRANSFERÊNCIA entre contas (ajusta os 2 saldos via trigger) =====================
INSERT INTO pf_transfers (collaborator_id, from_account, to_account, amount, description, transfer_date) VALUES
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','e74ef49a-8fd2-4cae-bbec-dba78b76e20c','b9e244ae-da1f-4b82-a6fd-e10dd0d386cf',2000,'Reserva','2026-05-25');

-- ===================== 5) LANÇAMENTOS NO CARTÃO (fatura) — account_id null, competencia = fatura =====================
-- Nubank=cd3a493d (fatura jun) / C6=48d8c6bf / Pão de Açúcar=af09d7da
INSERT INTO pf_transactions (collaborator_id, card_id, type, category, amount, description, transaction_date, competencia, via) VALUES
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','cd3a493d-e095-4542-bea6-0710137551fa','expense','tecnologia',230,'Fone Bluetooth','2026-05-30','2026-06-01','pwa'),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','48d8c6bf-ccb0-446e-852d-9001ad1cebd8','expense','compras',180,'Amazon','2026-05-29','2026-06-01','pwa'),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','48d8c6bf-ccb0-446e-852d-9001ad1cebd8','expense','vestuario',260,'Renner','2026-05-20','2026-06-01','pwa'),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','af09d7da-02a9-40b6-a3e1-71812390d901','expense','mercado',320,'Pão de Açúcar','2026-05-28','2026-06-01','pwa'),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','af09d7da-02a9-40b6-a3e1-71812390d901','expense','mercado',145,'Pão de Açúcar','2026-06-01','2026-06-01','pwa');

-- Compra parcelada: TV 3200 em 10x (320/parcela) no Nubank, competência espalhada jun→mar
INSERT INTO pf_transactions (collaborator_id, card_id, type, category, amount, description, transaction_date, competencia, installment_no, installments_total, purchase_group, via) VALUES
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','cd3a493d-e095-4542-bea6-0710137551fa','expense','eletrodomesticos',320,'TV 55" Samsung','2026-06-01','2026-06-01',1,10,'44444444-4444-4444-8444-444444444444','pwa'),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','cd3a493d-e095-4542-bea6-0710137551fa','expense','eletrodomesticos',320,'TV 55" Samsung','2026-06-01','2026-07-01',2,10,'44444444-4444-4444-8444-444444444444','pwa'),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','cd3a493d-e095-4542-bea6-0710137551fa','expense','eletrodomesticos',320,'TV 55" Samsung','2026-06-01','2026-08-01',3,10,'44444444-4444-4444-8444-444444444444','pwa'),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','cd3a493d-e095-4542-bea6-0710137551fa','expense','eletrodomesticos',320,'TV 55" Samsung','2026-06-01','2026-09-01',4,10,'44444444-4444-4444-8444-444444444444','pwa'),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','cd3a493d-e095-4542-bea6-0710137551fa','expense','eletrodomesticos',320,'TV 55" Samsung','2026-06-01','2026-10-01',5,10,'44444444-4444-4444-8444-444444444444','pwa'),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','cd3a493d-e095-4542-bea6-0710137551fa','expense','eletrodomesticos',320,'TV 55" Samsung','2026-06-01','2026-11-01',6,10,'44444444-4444-4444-8444-444444444444','pwa'),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','cd3a493d-e095-4542-bea6-0710137551fa','expense','eletrodomesticos',320,'TV 55" Samsung','2026-06-01','2026-12-01',7,10,'44444444-4444-4444-8444-444444444444','pwa'),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','cd3a493d-e095-4542-bea6-0710137551fa','expense','eletrodomesticos',320,'TV 55" Samsung','2026-06-01','2027-01-01',8,10,'44444444-4444-4444-8444-444444444444','pwa'),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','cd3a493d-e095-4542-bea6-0710137551fa','expense','eletrodomesticos',320,'TV 55" Samsung','2026-06-01','2027-02-01',9,10,'44444444-4444-4444-8444-444444444444','pwa'),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','cd3a493d-e095-4542-bea6-0710137551fa','expense','eletrodomesticos',320,'TV 55" Samsung','2026-06-01','2027-03-01',10,10,'44444444-4444-4444-8444-444444444444','pwa');

-- ===================== 6) CONTAS FIXAS (a pagar / a receber) =====================
INSERT INTO pf_bills (collaborator_id, name, amount, due_day, category, type, recurrence, status, last_paid_at) VALUES
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','Aluguel',1800,5,'moradia','expense','monthly','pending',NULL),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','Internet',120,8,'contas_consumo','expense','monthly','pending',NULL),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','Conta de Luz',150,10,'contas_consumo','expense','monthly','pending',NULL),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','Academia',99,12,'esportes','expense','monthly','pending',NULL),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','Netflix',55,2,'assinaturas','expense','monthly','paid','2026-06-02'),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','Salário',6500,5,'salario','income','monthly','pending',NULL),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','Aluguel recebido',1200,20,'aluguel_recebido','income','monthly','pending',NULL);

-- ===================== 7) METAS (current_amount sobe via aportes/trigger) =====================
INSERT INTO pf_goals (id, collaborator_id, name, target_amount, monthly_contribution, deadline, icon) VALUES
('11111111-1111-4111-8111-111111111111','0576f4b6-183d-4cf1-980e-5c8d5da0177f','Carro',20000,1000,'2027-06-01','🚗'),
('22222222-2222-4222-8222-222222222222','0576f4b6-183d-4cf1-980e-5c8d5da0177f','Reserva de emergência',15000,1500,'2026-12-01','🛟'),
('33333333-3333-4333-8333-333333333333','0576f4b6-183d-4cf1-980e-5c8d5da0177f','Viagem Europa',12000,800,'2027-03-01','✈️');

INSERT INTO pf_goal_contributions (collaborator_id, goal_id, amount, note, contributed_at) VALUES
-- Carro → 6000
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','11111111-1111-4111-8111-111111111111',1000,'Comecei a guardar','2026-02-10'),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','11111111-1111-4111-8111-111111111111',1500,NULL,'2026-03-10'),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','11111111-1111-4111-8111-111111111111',1500,NULL,'2026-04-10'),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','11111111-1111-4111-8111-111111111111',2000,'Bônus','2026-05-10'),
-- Reserva → 9500
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','22222222-2222-4222-8222-222222222222',5000,'Reserva inicial','2026-01-15'),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','22222222-2222-4222-8222-222222222222',2000,NULL,'2026-03-15'),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','22222222-2222-4222-8222-222222222222',2500,NULL,'2026-05-15'),
-- Viagem → 3200
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','33333333-3333-4333-8333-333333333333',1200,'Primeira parcela','2026-04-20'),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','33333333-3333-4333-8333-333333333333',2000,NULL,'2026-05-20');

-- ===================== 8) ORÇAMENTO do mês corrente (2026-06) =====================
INSERT INTO pf_budgets (collaborator_id, category, monthly_limit, month_year) VALUES
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','mercado',700,'2026-06'),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','alimentacao',400,'2026-06'),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','transporte',300,'2026-06'),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','lazer',300,'2026-06'),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','restaurante',400,'2026-06'),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','combustivel',500,'2026-06'),
('0576f4b6-183d-4cf1-980e-5c8d5da0177f','assinaturas',150,'2026-06');
