import unittest
from crawler.worker import extract


class ExtractionTests(unittest.TestCase):
    def test_catalog_ignores_sidebar(self):
        card = '<div class="postItem"><h2 class="postTitle"><a href="/filmy/1-example.html">A &amp; B</a></h2><img class="poster" data-src="/uploads/a.jpg"><span class="misc">2020, драма</span></div>'
        rows = extract('catalog', '<div id="dle-content">' + card + '</div><aside>' + card + '</aside>', 'https://lv.hdrezka.inc/')
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['title'], 'A & B')
        self.assertEqual(rows[0]['poster'], '/uploads/a.jpg')

    def test_detail_extracts_lazy_embeds_and_metadata(self):
        html = '''<div id="dle-content"><article class="innerPost"><h1>Example</h1>
        <table class="post__info"><tr><td>Дата выхода:</td><td>2020</td></tr></table>
        <div class="playerWrap"><ul class="player-tabs"><li data-src="https://player.example/1">Плеер 1</li></ul>
        <div class="player-container"><iframe data-src="https://player.example/1"></iframe></div></div></article></div>'''
        row = extract('movie', html, 'https://lv.hdrezka.inc/')[0]
        self.assertEqual(row['info'][0]['value'], '2020')
        self.assertEqual(row['players'][0]['name'], 'Плеер 1')
        self.assertEqual(row['players'][1]['url'], 'https://player.example/1')

    def test_challenge_is_not_an_empty_catalog(self):
        with self.assertRaises(ValueError):
            extract('catalog', '<h1>Вход</h1><input type="password">', 'https://rezka.fi/')


if __name__ == '__main__':
    unittest.main()
