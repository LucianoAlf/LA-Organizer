-- Task 19: Tabela loja_reservas com indexes
CREATE TABLE IF NOT EXISTS loja_reservas (
  id           SERIAL PRIMARY KEY,
  produto_id   INT NOT NULL REFERENCES loja_produtos(id),
  variacao_id  INT REFERENCES loja_variacoes(id),
  unidade_id   UUID NOT NULL REFERENCES unidades(id),
  aluno_id     INT REFERENCES alunos(id),
  cliente_nome VARCHAR(200),
  quantidade   INT NOT NULL CHECK (quantidade > 0),
  prazo        DATE NOT NULL,
  status       VARCHAR(20) NOT NULL DEFAULT 'ativa'
               CHECK (status IN ('ativa','finalizada','expirada','cancelada')),
  observacoes  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_via  TEXT,
  finalizada_em TIMESTAMPTZ,
  finalizada_venda_id INT REFERENCES loja_vendas(id),
  cancelada_em TIMESTAMPTZ,
  motivo_cancelamento TEXT
);

CREATE INDEX IF NOT EXISTS idx_loja_reservas_unidade_status ON loja_reservas (unidade_id, status);
CREATE INDEX IF NOT EXISTS idx_loja_reservas_prazo_ativa ON loja_reservas (prazo) WHERE status = 'ativa';
CREATE INDEX IF NOT EXISTS idx_loja_reservas_produto_unidade ON loja_reservas (produto_id, unidade_id) WHERE status = 'ativa';
