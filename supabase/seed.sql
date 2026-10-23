-- ==============================================================================
-- EMERGENCY PATH CLEARING - SEED DATA
-- Test users, profiles, and initial sample locations for local/dev environments
-- ==============================================================================

-- Test Passwords: password123 (bcrypt hash)
-- Note: In Supabase Auth, passwords use bcrypt $2a$10$...

DO $$
DECLARE
    v_dispatcher_id UUID := 'd159a1ce-0000-0000-0000-000000000001';
    v_ambulance_id UUID  := 'a3b01a4ce-0000-0000-0000-000000000001';
    v_citizen_id   UUID  := 'c1712e4ce-0000-0000-0000-000000000001';
    v_bcrypt_hash  TEXT  := '$2a$10$wE1MbmfPzPkyP6/5dMtz8e9zTf7yH3v9g2R2K4M4Yh.hP7bS0Fh/O'; -- password123
BEGIN
    -- 1. Create Dispatcher User in auth.users if not present
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'dispatcher1@gmail.com') THEN
        INSERT INTO auth.users (
            id, instance_id, aud, role, email, encrypted_password,
            email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
        ) VALUES (
            v_dispatcher_id,
            '00000000-0000-0000-0000-000000000000',
            'authenticated',
            'authenticated',
            'dispatcher1@gmail.com',
            v_bcrypt_hash,
            now(),
            '{"provider":"email","providers":["email"]}',
            '{}',
            now(),
            now()
        );

        INSERT INTO auth.identities (
            id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
        ) VALUES (
            v_dispatcher_id,
            v_dispatcher_id,
            jsonb_build_object('sub', v_dispatcher_id::text, 'email', 'dispatcher1@gmail.com'),
            'email',
            now(),
            now(),
            now()
        );
    END IF;

    -- 2. Create Ambulance User in auth.users if not present
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'ambulance1@gmail.com') THEN
        INSERT INTO auth.users (
            id, instance_id, aud, role, email, encrypted_password,
            email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
        ) VALUES (
            v_ambulance_id,
            '00000000-0000-0000-0000-000000000000',
            'authenticated',
            'authenticated',
            'ambulance1@gmail.com',
            v_bcrypt_hash,
            now(),
            '{"provider":"email","providers":["email"]}',
            '{}',
            now(),
            now()
        );

        INSERT INTO auth.identities (
            id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
        ) VALUES (
            v_ambulance_id,
            v_ambulance_id,
            jsonb_build_object('sub', v_ambulance_id::text, 'email', 'ambulance1@gmail.com'),
            'email',
            now(),
            now(),
            now()
        );
    END IF;

    -- 3. Update Profiles Roles
    UPDATE public.profiles SET role = 'dispatcher' WHERE id IN (SELECT id FROM auth.users WHERE email IN ('dispatcher1@gmail.com', 'dispatcher1@test.com'));
    UPDATE public.profiles SET role = 'ambulance' WHERE id IN (SELECT id FROM auth.users WHERE email IN ('ambulance1@gmail.com', 'ambulance1@test.com'));

END $$;
