-- How a cash_on_delivery order was paid (cash | card_pos | bank_transfer).
ALTER TABLE "print_orders" ADD COLUMN "paymentMethod" TEXT;
