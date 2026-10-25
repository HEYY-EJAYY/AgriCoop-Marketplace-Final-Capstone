type SupabaseTable<Row, Insert, Update> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type SupabaseDatabase = {
  public: {
    Tables: {
      profiles: SupabaseTable<
        {
          user_id: string;
          full_name: string | null;
          email: string | null;
          role_id: number | null;
          cooperative_id: string | null;
          account_status: string | null;
          created_at: string | null;
        },
        {
          user_id: string;
          full_name: string;
          email: string;
          role_id: number;
          cooperative_id?: string | null;
          account_status?: string | null;
          created_at?: string | null;
        },
        Partial<{
          full_name: string | null;
          email: string | null;
          role_id: number | null;
          cooperative_id: string | null;
          account_status: string | null;
        }>
      >;
      roles: SupabaseTable<
        {
          role_id: number;
          role_name: string;
        },
        {
          role_id?: number;
          role_name: string;
        },
        Partial<{
          role_id: number;
          role_name: string;
        }>
      >;
      cooperatives: SupabaseTable<
        {
          cooperative_id: string;
          name: string;
          location: string | null;
          created_at: string | null;
        },
        {
          name: string;
          location?: string | null;
          created_at?: string | null;
        },
        Partial<{
          name: string;
          location: string | null;
        }>
      >;
      products: SupabaseTable<
        {
          product_id: string;
          seller_id: string;
          product_name: string;
          category: string | null;
          price: number;
          unit: string | null;
          description: string | null;
          status: string | null;
          created_at: string | null;
        },
        {
          seller_id: string;
          product_name: string;
          price: number;
          category?: string | null;
          unit?: string | null;
          description?: string | null;
          status?: string | null;
          created_at?: string | null;
        },
        Partial<{
          seller_id: string;
          product_name: string;
          price: number;
          category: string | null;
          unit: string | null;
          description: string | null;
          status: string | null;
        }>
      >;
      inventory: SupabaseTable<
        {
          inventory_id: string;
          product_id: string;
          stock_quantity: number;
          last_updated: string | null;
        },
        {
          product_id: string;
          stock_quantity: number;
          last_updated?: string | null;
        },
        Partial<{
          product_id: string;
          stock_quantity: number;
          last_updated: string | null;
        }>
      >;
      quotations: SupabaseTable<
        {
          quotation_id: string;
          buyer_id: string;
          officer_id: string | null;
          status: string | null;
          created_at: string | null;
        },
        {
          buyer_id: string;
          officer_id?: string | null;
          status?: string | null;
          created_at?: string | null;
        },
        Partial<{
          buyer_id: string;
          officer_id: string | null;
          status: string | null;
        }>
      >;
      quotation_items: SupabaseTable<
        {
          quotation_item_id: string;
          quotation_id: string;
          product_id: string;
          requested_quantity: number;
          proposed_price: number | null;
        },
        {
          quotation_id: string;
          product_id: string;
          requested_quantity: number;
          proposed_price?: number | null;
        },
        Partial<{
          quotation_id: string;
          product_id: string;
          requested_quantity: number;
          proposed_price: number | null;
        }>
      >;
      orders: SupabaseTable<
        {
          order_id: string;
          buyer_id: string;
          officer_id: string | null;
          order_type: string;
          status: string | null;
          total_amount: number;
          created_at: string | null;
        },
        {
          buyer_id: string;
          officer_id?: string | null;
          order_type: string;
          status?: string | null;
          total_amount: number;
          created_at?: string | null;
        },
        Partial<{
          buyer_id: string;
          officer_id: string | null;
          order_type: string;
          status: string | null;
          total_amount: number;
        }>
      >;
      order_items: SupabaseTable<
        {
          order_item_id: string;
          order_id: string;
          product_id: string;
          quantity: number;
          subtotal: number;
        },
        {
          order_id: string;
          product_id: string;
          quantity: number;
          subtotal: number;
        },
        Partial<{
          order_id: string;
          product_id: string;
          quantity: number;
          subtotal: number;
        }>
      >;
      transactions: SupabaseTable<
        {
          transaction_id: string;
          order_id: string;
          payment_method: string;
          payment_status: string | null;
          gateway_reference: string | null;
          total_amount: number;
          paid_at: string | null;
          created_at: string | null;
        },
        {
          order_id: string;
          payment_method: string;
          total_amount: number;
          payment_status?: string | null;
          gateway_reference?: string | null;
          paid_at?: string | null;
          created_at?: string | null;
        },
        Partial<{
          order_id: string;
          payment_method: string;
          payment_status: string | null;
          gateway_reference: string | null;
          total_amount: number;
          paid_at: string | null;
        }>
      >;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
