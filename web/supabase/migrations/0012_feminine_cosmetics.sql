-- Existing catalog-driven shop and chest RPCs include these items automatically.
-- Rarity odds, prices by tier, and ownership requirements remain unchanged.
insert into public.cosmetic_catalog (id,name,category,rarity,color,price) values
 ('outfit-skirt-common','ชุดกระโปรงกีฬาเซจ','outfit','common','#72927D',50),
 ('outfit-dress-rare','เดรสคอร์ทโรส','outfit','rare','#C97786',150),
 ('outfit-skirt-epic','ชุดกระโปรงกีฬาไวโอเล็ต','outfit','epic','#79659B',400),
 ('outfit-dress-legendary','เดรสแชมเปียนโกลด์','outfit','legendary','#C49A4E',1000),
 ('head-bow-common','โบว์พีช','head','common','#C88E78',50),
 ('head-bow-rare','โบว์ลากูน','head','rare','#4E8F91',150);
